import { NextRequest, NextResponse } from "next/server";

// ---------- 음식 사진 인식 API ----------
// 클라이언트(웹/Expo 앱)에서 base64 이미지를 받아 Google Gemini API(Vision)로 음식 종류와
// 대략적인 칼로리·매크로를 추정합니다. API 키는 서버에서만 사용하므로 클라이언트에는
// 절대 노출되지 않습니다.
//
// 환경변수 설정 필요: .env.local 파일에 GEMINI_API_KEY=... 추가
// 키 발급: https://aistudio.google.com/app/apikey (무료 티어 제공)
//
// ⚠️ 사진만으로는 정확한 분량 측정이 불가능합니다. 여기서 나온 값은 "초안"이며,
// 반드시 사용자가 식단 폼에서 수량·칼로리를 확인/수정한 뒤 저장하도록 설계되어 있습니다.

// 실제 배포 전, 사용 가능한 최신 모델명을 Gemini 문서(ai.google.dev)에서 확인하고 필요시 교체하세요.
const GEMINI_MODEL = "gemini-2.0-flash";

const ANALYZE_PROMPT = `당신은 음식 사진을 분석하는 영양 어시스턴트입니다.
사진 속 음식을 보고 아래 JSON 형식으로만 답하세요. 다른 설명이나 마크다운 없이 JSON만 출력하세요.

{
  "name": "음식 이름 (한글)",
  "quantity": "예상 수량 (예: 1공기, 200g, 1개)",
  "calories": 숫자(kcal),
  "carbs": 숫자(g),
  "protein": 숫자(g),
  "fat": 숫자(g),
  "confidence": "high" | "medium" | "low"
}

여러 음식이 섞여 있으면 전체를 하나의 항목으로 합산해서 답하세요.
정확한 분량을 알 수 없으므로 일반적인 1인분 기준으로 추정하고, 추정 확신도가 낮으면 confidence를 "low"로 표시하세요.`;

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mediaType } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "이미지가 없습니다." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다." }, { status: 500 });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: ANALYZE_PROMPT },
                {
                  inline_data: {
                    mime_type: mediaType || "image/jpeg",
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 500,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `Gemini API 오류: ${errText}` }, { status: 502 });
    }

    const data = await response.json();
    const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 혹시 모델이 ```json 코드펜스로 감싸서 응답하면 제거
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI 응답을 해석하지 못했습니다. 다시 시도해주세요." }, { status: 502 });
    }

    return NextResponse.json({ result: parsed });
  } catch (err) {
    return NextResponse.json({ error: `분석 중 오류가 발생했습니다: ${String(err)}` }, { status: 500 });
  }
}
