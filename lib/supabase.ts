import { createClient } from "@supabase/supabase-js";

// .env.local 파일에 아래 두 값을 넣어주세요 (Supabase 프로젝트 설정 → API 메뉴에서 확인 가능):
// NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
// NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJI...
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // 환경변수가 비어있으면 화면이 알 수 없는 오류로 죽는 대신 콘솔에 명확히 알려줍니다.
  // eslint-disable-next-line no-console
  console.warn("Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)가 설정되지 않았습니다.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
