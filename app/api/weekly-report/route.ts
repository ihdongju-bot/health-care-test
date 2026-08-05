import { NextRequest, NextResponse } from "next/server";

// ---------- 주간 AI 리포트 API ----------
// 최근 7일간의 식사/운동 요약 데이터를 받아 Claude API로 개인화된 코칭 리포트를 생성합니다.
// 클라이언트는 원본 기록 전체가 아니라 이미 집계된 요약 수치만 보내도록 설계했습니다
// (프롬프트 크기 절약 + 불필요한 개인 식단 디테일 전송 최소화).

const REPORT_PROMPT_SYSTEM = `당신은 다정하고 격려하는 톤의 헬스케어 코치입니다.
사용자의 최근 7일 식단/운동 요약 데이터를 보고 짧은 주간 리포트를 작성하세요.

작성 규칙:
- 한국어로, 3~5문장 정도의 자연스러운 문단으로 작성 (불릿 리스트 X)
- 죄책감을 주거나 다그치는 톤 금지. "괜찮아요", "이 정도면 잘 하고 계세요" 같은 관대한 태도 유지
- 목표(감량/유지/증량) 대비 실제 섭취/운동 패턴에서 눈에 띄는 점 1~2가지를 구체적 수치와 함께 언급
- 다음 주에 시도해볼 만한 작은 제안 1가지로 마무리
- 의학적 진단이나 질병 관련 언급은 하지 말 것
- 데이터가 너무 적으면(예: 기록이 1~2일뿐) 그 사실을 자연스럽게 언급하고 꾸준한 기록을 권유`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { goalType, dailyTargetCalories, weeklyAvgCalories, weeklyWorkoutCount, daysWithMealLogs, macroAverages } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다." }, { status: 500 });
    }

    const userDataSummary = `
- 목표: ${goalType === "loss" ? "체중 감량" : goalType === "gain" ? "근육 증가" : "체중 유지"}
- 하루 권장 칼로리: ${dailyTargetCalories}kcal
- 최근 7일 일평균 섭취 칼로리: ${weeklyAvgCalories}kcal
- 최근 7일 중 식사 기록이 있었던 날: ${daysWithMealLogs}일
- 최근 7일 운동 횟수: ${weeklyWorkoutCount}회
- 최근 7일 평균 매크로: 탄수화물 ${macroAverages?.carbs ?? 0}g / 단백질 ${macroAverages?.protein ?? 0}g / 지방 ${macroAverages?.fat ?? 0}g
`.trim();

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // 실제 배포 전, 사용 가능한 최신 모델명을 Anthropic 문서에서 확인하고 필요시 교체하세요.
        model: "claude-sonnet-5",
        max_tokens: 500,
        system: REPORT_PROMPT_SYSTEM,
        messages: [{ role: "user", content: `다음 데이터로 주간 리포트를 작성해주세요:\n\n${userDataSummary}` }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `Claude API 오류: ${errText}` }, { status: 502 });
    }

    const data = await response.json();
    const textBlock = data.content?.find((c: { type: string }) => c.type === "text");
    const report: string = textBlock?.text?.trim() || "리포트를 생성하지 못했어요. 다시 시도해주세요.";

    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json({ error: `리포트 생성 중 오류가 발생했습니다: ${String(err)}` }, { status: 500 });
  }
}
