import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// 아래 두 값을 실제 Supabase 프로젝트 값으로 교체하세요
// (Supabase 프로젝트 설정 → API 메뉴에서 확인 가능).
// 웹 버전(.env.local)과 동일한 프로젝트 값을 사용하면 됩니다.
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
