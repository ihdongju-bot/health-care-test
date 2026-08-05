"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// ---------- 타입 정의 ----------
type Meal = {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  quantity: string;
  calories: number;
  carbs: number; // g
  protein: number; // g
  fat: number; // g
};

type Workout = {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  sets: number;
  weight: number; // kg
  reps: number;
};

type Tab = "home" | "meal" | "workout" | "goal" | "history" | "ranking" | "recommend" | "community";

// ---------- 날짜 유틸 ----------
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
}

function addDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

type GoalType = "loss" | "maintain" | "gain";

// ---------- 권장 섭취 기준 (목표 설정 기반 자동 계산) ----------
// 체중(kg)과 목표 유형(감량/유지/증량)을 입력하면 일일 권장 칼로리·매크로를 계산합니다.
// 나이/키/성별/활동량 없이 체중만으로 추정하는 간이 공식이라 참고용 수치입니다.
// - 칼로리: 체중(kg) × 목표별 계수
// - 단백질: 체중(kg) × 목표별 계수 (근성장/체중감량 시 단백질 비중을 높게)
// - 지방: 전체 칼로리의 25%
// - 탄수화물: 나머지 칼로리
const CALORIE_FACTOR: Record<GoalType, number> = { loss: 28, maintain: 33, gain: 38 };
const PROTEIN_FACTOR: Record<GoalType, number> = { loss: 1.8, maintain: 1.4, gain: 2.0 };
const FAT_RATIO = 0.25;

const GOAL_LABEL: Record<GoalType, string> = { loss: "체중 감량", maintain: "체중 유지", gain: "근육 증가" };

function calcDailyTarget(goalType: GoalType, weightKg: number) {
  const calories = Math.round(weightKg * CALORIE_FACTOR[goalType]);
  const protein = Math.round(weightKg * PROTEIN_FACTOR[goalType]);
  const proteinKcal = protein * 4;
  const fatKcal = calories * FAT_RATIO;
  const fat = Math.round(fatKcal / 9);
  const carbKcal = Math.max(calories - proteinKcal - fatKcal, 0);
  const carbs = Math.round(carbKcal / 4);
  return { calories, protein, fat, carbs };
}

// ---------- 체급 비교용 레퍼런스 선수 데이터 (국내 보디빌더) ----------
// 공개된 인터뷰/나무위키/보도 기준 신장이며, 체중·체지방률은 대부분 정확한 대회 실측치가
// 공개되어 있지 않아 알려진 범위 내 근사치를 사용했습니다. 골격근량은 정밀 측정치가 없어
// "체중 × (1-체지방률)"로 계산한 제지방량(근육+뼈 등 포함 추정치)으로 대체 표기합니다.
// ※ 추후 실제 골격근량 수치를 전달받으면 이 부분을 실측값으로 교체할 예정.
type ReferenceAthlete = {
  name: string;
  category: string;
  heightCm: number;
  weightKg: number;
  bodyFatPct: number;
};

const REFERENCE_ATHLETES: ReferenceAthlete[] = [
  { name: "이승철", category: "오픈 보디빌딩 · 2020 올림피아 오픈 12위(한국 최초)", heightCm: 176, weightKg: 128, bodyFatPct: 12 }, // 체중은 공개된 비시즌 범위(125~130kg)의 중간값, 체지방률은 비시즌 추정치
  { name: "강경원", category: "212 보디빌딩 · 한국 최초 IFBB 프로, 2015 올림피아 212 11위", heightCm: 170, weightKg: 96, bodyFatPct: 5 }, // 체중은 212 체급 상한(96kg) 근사치, 체지방률은 대회 시즌 일반 추정치
  { name: "김강민", category: "212 보디빌딩 · NABBA 프로, 나바 프로전 5회 우승", heightCm: 172, weightKg: 90, bodyFatPct: 10 }, // 체중은 212 체급 특성상 근사치, 체지방률은 "비시즌에도 10% 미만 유지"로 알려진 수치
];

function estimateLeanMass(weightKg: number, bodyFatPct: number): number {
  return Math.round(weightKg * (1 - bodyFatPct / 100));
}

// ---------- 추천 운동 영상/음악 (정적 데이터) ----------
// 실제 존재하는 채널/플레이리스트로 구성했습니다. 특정 영상 하나를 지정하는 대신
// 채널 홈 또는 검색 결과 링크로 연결해, 콘텐츠가 사라지거나 바뀌어도 깨지지 않게 했습니다.
type RecommendedVideo = { title: string; source: string; url: string };
type RecommendedPlaylist = { title: string; source: string; url: string };

const RECOMMENDED_VIDEOS: RecommendedVideo[] = [
  { title: "전신 홈트레이닝", source: "땅끄부부 (구독자 300만)", url: "https://www.youtube.com/channel/UCpg89Ys3E4BaLGgEEWVmI9g" },
  { title: "필라테스 · 스트레칭", source: "빵느", url: "https://www.youtube.com/@bbangneu" },
  { title: "웨이트 트레이닝", source: "힙으뜸 (국내 1위 여성 운동 크리에이터)", url: "https://www.youtube.com/channel/UC4yq3FWEWqMvFNFBsV3gbKQ" },
  { title: "홈워크아웃", source: "루나홈트 LUNA WORKOUT", url: "https://www.youtube.com/@lunaworkout" },
];

const RECOMMENDED_PLAYLISTS: RecommendedPlaylist[] = [
  { title: "고 투 더 퍼킹 짐! 운동 자극 플레이리스트 💪", source: "Spotify · HIP", url: "https://open.spotify.com/playlist/1biqq8L1iPtTm8tGS8roNK" },
  { title: "러닝 · 유산소 플레이리스트 찾기", source: "Spotify 검색", url: "https://open.spotify.com/search/running%20workout%20playlist" },
  { title: "요가 · 스트레칭 플레이리스트 찾기", source: "Spotify 검색", url: "https://open.spotify.com/search/yoga%20stretching%20playlist" },
  { title: "고강도 인터벌(HIIT) 플레이리스트 찾기", source: "Spotify 검색", url: "https://open.spotify.com/search/HIIT%20workout%20playlist" },
];

// ---------- 색상 토큰 (Tailwind arbitrary value로 사용) ----------
// bg:      #F4F8F6 (부드러운 민트 화이트)
// card:    #F9FBFA (순백 대신 은은한 오프화이트, 눈부심 완화) / border #E2ECE8
// primary: #16665A (딥 틸)
// carb:    #F2A93B (앰버)
// protein: #1F8A70 (틸)
// fat:     #F16F5C (코랄)
// text:    #14231F / muted #6B8079

// ---------- 로그인 / 회원가입 ----------
function AuthScreen({ onBack }: { onBack?: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) setError(signInError.message);
      } else {
        const { error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (signUpError) {
          setError(signUpError.message);
        } else {
          setInfo("가입 확인 이메일을 보냈어요. 메일함을 확인한 뒤 로그인해주세요.");
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[#F4F8F6] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="text-xs font-medium text-[#6B8079] text-center">헬스케어 앱</p>
        <h1 className="text-2xl font-bold text-center mt-1 mb-8 text-[#14231F]">
          {mode === "signin" ? "로그인" : "회원가입"}
        </h1>

        <form onSubmit={handleSubmit} className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm space-y-3">
          <Input label="이메일" value={email} onChange={setEmail} placeholder="you@example.com" type="email" />
          <Input label="비밀번호" value={password} onChange={setPassword} placeholder="6자 이상" type="password" />

          {error && <p className="text-xs text-[#F16F5C]">{error}</p>}
          {info && <p className="text-xs text-[#16665A]">{info}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[#16665A] text-white font-semibold py-2.5 rounded-xl shadow-sm transition-all hover:bg-[#125349] hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:opacity-80 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
          >
            {isSubmitting ? "처리 중..." : mode === "signin" ? "로그인" : "회원가입"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError(null);
            setInfo(null);
          }}
          className="w-full text-center text-xs text-[#6B8079] font-medium mt-4 transition-colors hover:text-[#16665A] active:opacity-60"
        >
          {mode === "signin" ? "계정이 없으신가요? " : "이미 계정이 있으신가요? "}
          <span className="underline underline-offset-2">{mode === "signin" ? "회원가입" : "로그인"}</span>
        </button>

        {onBack && (
          <button
            onClick={onBack}
            className="w-full text-center text-xs text-[#6B8079] font-medium mt-2 transition-colors hover:text-[#16665A] active:opacity-60"
          >
            나중에 할게요 · 둘러보기 계속하기
          </button>
        )}
      </div>
    </div>
  );
}

export default function HealthcareHomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [todayKey] = useState<string>(() => toDateKey(new Date()));

  // ---------- 인증 ----------
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) setShowAuth(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const requireAuth = () => setShowAuth(true);

  // ---------- 데이터 (Supabase에서 로드) ----------
  const [meals, setMeals] = useState<Meal[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [goalType, setGoalType] = useState<GoalType>("maintain");
  const [weightKgText, setWeightKgText] = useState("70");
  const [displayName, setDisplayName] = useState("");
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    (async () => {
      const userId = session.user.id;

      const [mealsRes, workoutsRes, profileRes] = await Promise.all([
        supabase.from("meals").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("workouts").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      ]);

      if (cancelled) return;

      if (mealsRes.data) {
        setMeals(
          mealsRes.data.map((r) => ({
            id: r.id,
            date: r.date,
            name: r.name,
            quantity: r.quantity,
            calories: r.calories,
            carbs: r.carbs,
            protein: r.protein,
            fat: r.fat,
          }))
        );
      }
      if (workoutsRes.data) {
        setWorkouts(
          workoutsRes.data.map((r) => ({
            id: r.id,
            date: r.date,
            name: r.name,
            sets: r.sets,
            weight: r.weight,
            reps: r.reps,
          }))
        );
      }

      if (profileRes.data) {
        setGoalType(profileRes.data.goal_type);
        setWeightKgText(String(profileRes.data.weight_kg));
        setDisplayName(profileRes.data.display_name || "");
      } else {
        // 최초 로그인 시 기본 프로필 행 생성
        await supabase.from("profiles").insert({ user_id: userId, goal_type: "maintain", weight_kg: 70 });
      }

      setDataLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  // ---------- 목표 설정/닉네임 변경 시 Supabase에 저장 ----------
  useEffect(() => {
    if (!session || !dataLoaded) return;
    const weightKg = Number(weightKgText) || 0;
    supabase
      .from("profiles")
      .upsert({
        user_id: session.user.id,
        goal_type: goalType,
        weight_kg: weightKg,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      })
      .then(() => {});
  }, [goalType, weightKgText, displayName, session, dataLoaded]);

  // ---------- 식사/운동 CRUD (Supabase와 동기화) ----------
  async function addMeal(input: Omit<Meal, "id">) {
    if (!session) return;
    const { data, error } = await supabase
      .from("meals")
      .insert({ user_id: session.user.id, ...input })
      .select()
      .single();
    if (!error && data) {
      setMeals((prev) => [
        { id: data.id, date: data.date, name: data.name, quantity: data.quantity, calories: data.calories, carbs: data.carbs, protein: data.protein, fat: data.fat },
        ...prev,
      ]);
    }
  }

  async function deleteMeal(id: string) {
    setMeals((prev) => prev.filter((m) => m.id !== id)); // 낙관적 업데이트
    await supabase.from("meals").delete().eq("id", id);
  }

  async function addWorkout(input: Omit<Workout, "id">) {
    if (!session) return;
    const { data, error } = await supabase
      .from("workouts")
      .insert({ user_id: session.user.id, ...input })
      .select()
      .single();
    if (!error && data) {
      setWorkouts((prev) => [
        { id: data.id, date: data.date, name: data.name, sets: data.sets, weight: data.weight, reps: data.reps },
        ...prev,
      ]);
    }
  }

  async function deleteWorkout(id: string) {
    setWorkouts((prev) => prev.filter((w) => w.id !== id)); // 낙관적 업데이트
    await supabase.from("workouts").delete().eq("id", id);
  }

  const dailyTarget = useMemo(() => {
    const weightKg = Number(weightKgText) || 0;
    return calcDailyTarget(goalType, weightKg);
  }, [goalType, weightKgText]);

  // ---------- 오늘의 요약 계산 (오늘 날짜 기록만 집계) ----------
  const todayMeals = useMemo(() => meals.filter((m) => m.date === todayKey), [meals, todayKey]);
  const todayWorkouts = useMemo(() => workouts.filter((w) => w.date === todayKey), [workouts, todayKey]);

  const summary = useMemo(() => {
    const totalCalories = todayMeals.reduce((sum, m) => sum + m.calories, 0);
    const carbsG = todayMeals.reduce((sum, m) => sum + m.carbs, 0);
    const proteinG = todayMeals.reduce((sum, m) => sum + m.protein, 0);
    const fatG = todayMeals.reduce((sum, m) => sum + m.fat, 0);

    const carbsKcal = carbsG * 4;
    const proteinKcal = proteinG * 4;
    const fatKcal = fatG * 9;
    const macroTotalKcal = carbsKcal + proteinKcal + fatKcal || 1; // 0 나눗셈 방지

    return {
      totalCalories,
      carbsG,
      proteinG,
      fatG,
      carbsPct: Math.round((carbsKcal / macroTotalKcal) * 100),
      proteinPct: Math.round((proteinKcal / macroTotalKcal) * 100),
      fatPct: Math.round((fatKcal / macroTotalKcal) * 100),
    };
  }, [todayMeals]);

  if (!authChecked) {
    return (
      <div className="min-h-dvh bg-[#F4F8F6] flex items-center justify-center">
        <p className="text-sm text-[#6B8079]">불러오는 중...</p>
      </div>
    );
  }

  if (!session && showAuth) {
    return <AuthScreen onBack={() => setShowAuth(false)} />;
  }

  if (session && !dataLoaded) {
    return (
      <div className="min-h-dvh bg-[#F4F8F6] flex items-center justify-center">
        <p className="text-sm text-[#6B8079]">데이터를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F4F8F6] text-[#14231F] flex justify-center">
      {/* 모바일 화면 폭 고정 컨테이너 */}
      <div className="w-full max-w-md min-h-dvh bg-[#F4F8F6] flex flex-col relative">
        {/* 헤더 */}
        <header className="px-5 pt-6 pb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-[#6B8079]">
              {new Date().toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </p>
            <h1 className="text-xl font-bold mt-1">
              {activeTab === "home" && "오늘의 요약"}
              {activeTab === "meal" && "식단 관리"}
              {activeTab === "workout" && "운동 관리"}
              {activeTab === "goal" && "목표 설정"}
              {activeTab === "history" && "기록 히스토리"}
              {activeTab === "ranking" && "주간 랭킹"}
              {activeTab === "recommend" && "추천 콘텐츠"}
              {activeTab === "community" && "커뮤니티"}
            </h1>
          </div>
          {session ? (
            <button
              onClick={() => supabase.auth.signOut()}
              className="text-xs text-[#6B8079] font-medium mt-1"
            >
              로그아웃
            </button>
          ) : (
            <button
              onClick={requireAuth}
              className="text-xs text-[#16665A] font-semibold mt-1"
            >
              로그인
            </button>
          )}
        </header>

        {!session && (
          <div className="mx-5 mb-4 bg-[#F9FBFA] border border-[#E2ECE8] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[#6B8079] leading-relaxed">
              지금은 둘러보기 모드예요. 로그인하면 기록이 저장돼요.
            </p>
            <button
              onClick={requireAuth}
              className="shrink-0 text-xs font-semibold text-white bg-[#16665A] rounded-lg px-3 py-1.5 active:opacity-80 transition-opacity"
            >
              로그인
            </button>
          </div>
        )}

        {/* 본문 (탭별 콘텐츠) */}
        <main className="flex-1 px-5 pb-28 overflow-y-auto">
          {activeTab === "home" && (
            <HomeView summary={summary} meals={todayMeals} workouts={todayWorkouts} dailyTarget={dailyTarget} />
          )}
          {activeTab === "meal" && (
            <MealView meals={todayMeals} onAdd={addMeal} onDelete={deleteMeal} todayKey={todayKey} isGuest={!session} onRequireAuth={requireAuth} />
          )}
          {activeTab === "workout" && (
            <WorkoutView workouts={todayWorkouts} onAdd={addWorkout} onDelete={deleteWorkout} todayKey={todayKey} isGuest={!session} onRequireAuth={requireAuth} />
          )}
          {activeTab === "goal" && (
            <GoalView
              goalType={goalType}
              setGoalType={setGoalType}
              weightKgText={weightKgText}
              setWeightKgText={setWeightKgText}
              displayName={displayName}
              setDisplayName={setDisplayName}
              dailyTarget={dailyTarget}
              isGuest={!session}
            />
          )}
          {activeTab === "history" && (
            <HistoryView meals={meals} workouts={workouts} todayKey={todayKey} goalType={goalType} dailyTarget={dailyTarget} />
          )}
          {activeTab === "ranking" && <RankingView />}
          {activeTab === "recommend" && <RecommendView />}
          {activeTab === "community" && <CommunityView session={session} displayName={displayName} onRequireAuth={requireAuth} />}
        </main>

        {/* 하단 탭 네비게이션 (탭이 많아 가로 스크롤 방식) */}
        <nav className="fixed bottom-0 w-full max-w-md bg-[#F9FBFA] border-t border-[#E2ECE8] px-1 py-2 flex gap-1 overflow-x-auto">
          <TabButton label="홈" icon="🏠" active={activeTab === "home"} onClick={() => setActiveTab("home")} />
          <TabButton label="식단" icon="🍽️" active={activeTab === "meal"} onClick={() => setActiveTab("meal")} />
          <TabButton label="운동" icon="🏋️" active={activeTab === "workout"} onClick={() => setActiveTab("workout")} />
          <TabButton label="목표" icon="🎯" active={activeTab === "goal"} onClick={() => setActiveTab("goal")} />
          <TabButton label="기록" icon="📅" active={activeTab === "history"} onClick={() => setActiveTab("history")} />
          <TabButton label="랭킹" icon="🏆" active={activeTab === "ranking"} onClick={() => setActiveTab("ranking")} />
          <TabButton label="추천" icon="🎵" active={activeTab === "recommend"} onClick={() => setActiveTab("recommend")} />
          <TabButton label="커뮤니티" icon="👥" active={activeTab === "community"} onClick={() => setActiveTab("community")} />
        </nav>
      </div>
    </div>
  );
}

// ---------- 하단 탭 버튼 ----------
function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl shrink-0 transition-all duration-150 hover:bg-[#F4F8F6] active:scale-90 active:bg-[#E2ECE8] ${
        active ? "text-[#16665A]" : "text-[#6B8079] hover:text-[#16665A]"
      }`}
    >
      <span className="text-lg">{icon}</span>
      <span className={`text-[11px] ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
    </button>
  );
}

// ---------- 홈(대시보드) ----------
function HomeView({
  summary,
  meals,
  workouts,
  dailyTarget,
}: {
  summary: {
    totalCalories: number;
    carbsG: number;
    proteinG: number;
    fatG: number;
    carbsPct: number;
    proteinPct: number;
    fatPct: number;
  };
  meals: Meal[];
  workouts: Workout[];
  dailyTarget: { calories: number; carbs: number; protein: number; fat: number };
}) {
  return (
    <div className="space-y-4">
      {/* 칼로리 요약 카드 */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <p className="text-sm text-[#6B8079] font-medium">오늘 섭취 칼로리</p>
        <p className="text-3xl font-bold mt-1">
          {summary.totalCalories.toLocaleString()} <span className="text-base font-medium text-[#6B8079]">kcal</span>
        </p>
      </div>

      {/* 탄단지 비율 요약 카드 */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <p className="text-sm text-[#6B8079] font-medium mb-3">탄수화물 · 단백질 · 지방 비율</p>

        {/* 스택형 비율 바 */}
        <div className="w-full h-3 rounded-full overflow-hidden flex bg-[#F4F8F6]">
          <div className="h-full bg-[#F2A93B]" style={{ width: `${summary.carbsPct}%` }} />
          <div className="h-full bg-[#1F8A70]" style={{ width: `${summary.proteinPct}%` }} />
          <div className="h-full bg-[#F16F5C]" style={{ width: `${summary.fatPct}%` }} />
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <MacroStat color="#F2A93B" label="탄수화물" pct={summary.carbsPct} grams={summary.carbsG} />
          <MacroStat color="#1F8A70" label="단백질" pct={summary.proteinPct} grams={summary.proteinG} />
          <MacroStat color="#F16F5C" label="지방" pct={summary.fatPct} grams={summary.fatG} />
        </div>
      </div>

      {/* 하루 권장 섭취량 대비 (4끼 기준) */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-sm text-[#6B8079] font-medium">하루 권장 섭취량 대비</p>
          <p className="text-[11px] text-[#6B8079]">{dailyTarget.calories.toLocaleString()}kcal 목표</p>
        </div>
        <div className="space-y-3">
          <TargetBar label="칼로리" color="#16665A" actual={summary.totalCalories} target={dailyTarget.calories} unit="kcal" />
          <TargetBar label="탄수화물" color="#F2A93B" actual={summary.carbsG} target={dailyTarget.carbs} unit="g" />
          <TargetBar label="단백질" color="#1F8A70" actual={summary.proteinG} target={dailyTarget.protein} unit="g" />
          <TargetBar label="지방" color="#F16F5C" actual={summary.fatG} target={dailyTarget.fat} unit="g" />
        </div>
      </div>

      {/* 간단 현황 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-4 shadow-sm">
          <p className="text-xs text-[#6B8079] font-medium">기록된 식사</p>
          <p className="text-2xl font-bold mt-1">{meals.length}건</p>
        </div>
        <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-4 shadow-sm">
          <p className="text-xs text-[#6B8079] font-medium">기록된 운동</p>
          <p className="text-2xl font-bold mt-1">{workouts.length}건</p>
        </div>
      </div>
    </div>
  );
}

function TargetBar({
  label,
  color,
  actual,
  target,
  unit,
}: {
  label: string;
  color: string;
  actual: number;
  target: number;
  unit: string;
}) {
  const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
  const barWidth = Math.min(pct, 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[#14231F]">{label}</span>
        <span className="text-xs text-[#6B8079]">
          {actual.toLocaleString()} / {target.toLocaleString()}
          {unit} <span className="font-semibold text-[#14231F]">({pct}%)</span>
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-[#F4F8F6] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${barWidth}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function MacroStat({
  color,
  label,
  pct,
  grams,
  showPct = true,
}: {
  color: string;
  label: string;
  pct: number;
  grams: number;
  showPct?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs text-[#6B8079]">{label}</span>
      </div>
      {showPct && <p className="text-sm font-bold mt-1">{pct}%</p>}
      <p className="text-[11px] text-[#6B8079]">{grams}g</p>
    </div>
  );
}

// ---------- 식단 관리 ----------
function MealView({
  meals,
  onAdd,
  onDelete,
  todayKey,
  isGuest,
  onRequireAuth,
}: {
  meals: Meal[];
  onAdd: (input: Omit<Meal, "id">) => void;
  onDelete: (id: string) => void;
  todayKey: string;
  isGuest: boolean;
  onRequireAuth: () => void;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [calories, setCalories] = useState("");
  const [carbs, setCarbs] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");

  // ---------- 사진 인식 ----------
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [aiConfidence, setAiConfidence] = useState<string | null>(null);

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    setAnalyzeError(null);
    setAiConfidence(null);

    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: file.type || "image/jpeg" }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAnalyzeError(data.error || "인식에 실패했어요. 다시 시도해주세요.");
        return;
      }

      const result = data.result;
      setName(result.name || "");
      setQuantity(result.quantity || "");
      setCalories(String(result.calories ?? ""));
      setCarbs(String(result.carbs ?? ""));
      setProtein(String(result.protein ?? ""));
      setFat(String(result.fat ?? ""));
      setAiConfidence(result.confidence || null);
    } catch {
      setAnalyzeError("네트워크 오류로 인식에 실패했어요.");
    } finally {
      setIsAnalyzing(false);
      e.target.value = "";
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !calories) return;
    if (isGuest) {
      onRequireAuth();
      return;
    }

    onAdd({
      date: todayKey,
      name: name.trim(),
      quantity: quantity.trim() || "1인분",
      calories: Number(calories) || 0,
      carbs: Number(carbs) || 0,
      protein: Number(protein) || 0,
      fat: Number(fat) || 0,
    });
    setName("");
    setQuantity("");
    setCalories("");
    setCarbs("");
    setProtein("");
    setFat("");
    setAiConfidence(null);
  }

  function handleDelete(id: string) {
    onDelete(id);
  }

  return (
    <div className="space-y-5">
      {isGuest && (
        <div className="bg-[#F9FBFA] border border-[#E2ECE8] rounded-xl px-4 py-3">
          <p className="text-xs text-[#6B8079] leading-relaxed">
            둘러보기 모드에서는 식사 기록을 저장할 수 없어요.{" "}
            <button onClick={onRequireAuth} className="text-[#16665A] font-semibold underline underline-offset-2">
              로그인
            </button>
            하면 기록이 저장돼요.
          </p>
        </div>
      )}

      {/* 사진으로 인식 */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-4 shadow-sm">
        <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-[#E2ECE8] rounded-xl py-4 cursor-pointer active:bg-[#F4F8F6] transition-colors">
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoSelect} disabled={isAnalyzing} />
          <span className="text-xl">📷</span>
          <span className="text-sm font-semibold text-[#16665A]">
            {isAnalyzing ? "AI가 사진을 분석하는 중..." : "사진으로 음식 인식하기"}
          </span>
        </label>
        {analyzeError && <p className="text-xs text-[#F16F5C] mt-2">{analyzeError}</p>}
        {aiConfidence && !analyzeError && (
          <p className="text-xs text-[#6B8079] mt-2">
            AI가 인식한 초안이에요 (신뢰도: {aiConfidence === "high" ? "높음" : aiConfidence === "medium" ? "보통" : "낮음"}). 아래에서 값을 확인하고 추가해주세요.
          </p>
        )}
      </div>

      {/* 입력 폼 */}
      <form onSubmit={handleSubmit} className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="음식명" value={name} onChange={setName} placeholder="예: 현미밥" />
          <Input label="수량" value={quantity} onChange={setQuantity} placeholder="예: 1공기" />
        </div>
        <Input label="칼로리 (kcal)" value={calories} onChange={setCalories} placeholder="예: 300" type="number" />
        <div className="grid grid-cols-3 gap-3">
          <Input label="탄수화물(g)" value={carbs} onChange={setCarbs} placeholder="0" type="number" />
          <Input label="단백질(g)" value={protein} onChange={setProtein} placeholder="0" type="number" />
          <Input label="지방(g)" value={fat} onChange={setFat} placeholder="0" type="number" />
        </div>
        <button
          type="submit"
          className="w-full bg-[#16665A] text-white font-semibold py-2.5 rounded-xl active:opacity-80 transition-opacity"
        >
          식사 기록 추가
        </button>
      </form>

      {/* 기록 목록 */}
      <div className="space-y-2">
        {meals.length === 0 && <EmptyState text="아직 기록된 식사가 없어요. 위에서 추가해보세요." />}
        {meals.map((meal) => (
          <div
            key={meal.id}
            className="bg-[#F9FBFA] rounded-xl border border-[#E2ECE8] p-3.5 flex items-center justify-between shadow-sm"
          >
            <div>
              <p className="font-semibold text-sm">{meal.name}</p>
              <p className="text-xs text-[#6B8079] mt-0.5">
                {meal.quantity} · {meal.calories}kcal · 탄{meal.carbs} 단{meal.protein} 지{meal.fat}
              </p>
            </div>
            <button
              onClick={() => handleDelete(meal.id)}
              className="text-xs text-[#F16F5C] font-medium px-2 py-1"
              aria-label="삭제"
            >
              삭제
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 운동 관리 ----------
function WorkoutView({
  workouts,
  onAdd,
  onDelete,
  todayKey,
  isGuest,
  onRequireAuth,
}: {
  workouts: Workout[];
  onAdd: (input: Omit<Workout, "id">) => void;
  onDelete: (id: string) => void;
  todayKey: string;
  isGuest: boolean;
  onRequireAuth: () => void;
}) {
  const [name, setName] = useState("");
  const [sets, setSets] = useState("");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sets) return;
    if (isGuest) {
      onRequireAuth();
      return;
    }

    onAdd({
      date: todayKey,
      name: name.trim(),
      sets: Number(sets) || 0,
      weight: Number(weight) || 0,
      reps: Number(reps) || 0,
    });
    setName("");
    setSets("");
    setWeight("");
    setReps("");
  }

  function handleDelete(id: string) {
    onDelete(id);
  }

  return (
    <div className="space-y-5">
      {isGuest && (
        <div className="bg-[#F9FBFA] border border-[#E2ECE8] rounded-xl px-4 py-3">
          <p className="text-xs text-[#6B8079] leading-relaxed">
            둘러보기 모드에서는 운동 기록을 저장할 수 없어요.{" "}
            <button onClick={onRequireAuth} className="text-[#16665A] font-semibold underline underline-offset-2">
              로그인
            </button>
            하면 기록이 저장돼요.
          </p>
        </div>
      )}

      {/* 입력 폼 */}
      <form onSubmit={handleSubmit} className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-4 shadow-sm space-y-3">
        <Input label="종목" value={name} onChange={setName} placeholder="예: 벤치프레스" />
        <div className="grid grid-cols-3 gap-3">
          <Input label="세트" value={sets} onChange={setSets} placeholder="0" type="number" />
          <Input label="무게(kg)" value={weight} onChange={setWeight} placeholder="0" type="number" />
          <Input label="횟수" value={reps} onChange={setReps} placeholder="0" type="number" />
        </div>
        <button
          type="submit"
          className="w-full bg-[#16665A] text-white font-semibold py-2.5 rounded-xl active:opacity-80 transition-opacity"
        >
          운동 기록 추가
        </button>
      </form>

      {/* 기록 목록 */}
      <div className="space-y-2">
        {workouts.length === 0 && <EmptyState text="아직 기록된 운동이 없어요. 위에서 추가해보세요." />}
        {workouts.map((w) => (
          <div
            key={w.id}
            className="bg-[#F9FBFA] rounded-xl border border-[#E2ECE8] p-3.5 flex items-center justify-between shadow-sm"
          >
            <div>
              <p className="font-semibold text-sm">{w.name}</p>
              <p className="text-xs text-[#6B8079] mt-0.5">
                {w.sets}세트 · {w.weight}kg · {w.reps}회
              </p>
            </div>
            <button
              onClick={() => handleDelete(w.id)}
              className="text-xs text-[#F16F5C] font-medium px-2 py-1"
              aria-label="삭제"
            >
              삭제
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 목표 설정 ----------
function GoalView({
  goalType,
  setGoalType,
  weightKgText,
  setWeightKgText,
  displayName,
  setDisplayName,
  dailyTarget,
  isGuest,
}: {
  goalType: GoalType;
  setGoalType: (g: GoalType) => void;
  weightKgText: string;
  setWeightKgText: (v: string) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  dailyTarget: { calories: number; carbs: number; protein: number; fat: number };
  isGuest: boolean;
}) {
  const goalOptions: GoalType[] = ["loss", "maintain", "gain"];
  const userWeightKg = Number(weightKgText) || 0;

  return (
    <div className="space-y-4">
      {isGuest && (
        <div className="bg-[#F9FBFA] border border-[#E2ECE8] rounded-xl px-4 py-3">
          <p className="text-xs text-[#6B8079] leading-relaxed">
            둘러보기 모드예요. 지금 바꾸는 목표는 저장되지 않아요. 로그인하면 저장돼요.
          </p>
        </div>
      )}

      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <p className="text-sm text-[#6B8079] font-medium mb-3">목표를 선택하세요</p>
        <div className="flex gap-2">
          {goalOptions.map((g) => {
            const active = goalType === g;
            return (
              <button
                key={g}
                onClick={() => setGoalType(g)}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors ${
                  active ? "bg-[#16665A] border-[#16665A] text-white" : "bg-[#F4F8F6] border-[#E2ECE8] text-[#14231F]"
                }`}
              >
                {GOAL_LABEL[g]}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <Input
            label="현재 체중 (kg)"
            value={weightKgText}
            onChange={setWeightKgText}
            placeholder="예: 70"
            type="number"
          />
        </div>
        <p className="text-[11px] text-[#6B8079] mt-2 leading-relaxed">
          나이·키·활동량은 반영되지 않은 간이 추정치예요. 실제 권장 섭취량은 전문가와 상담하는 것이 가장 정확합니다.
        </p>
      </div>

      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <Input
          label="랭킹에 표시할 닉네임"
          value={displayName}
          onChange={setDisplayName}
          placeholder="비워두면 '익명 유저'로 표시돼요"
        />
        <p className="text-[11px] text-[#6B8079] mt-2 leading-relaxed">
          🏆 랭킹 탭에서 다른 사용자와 이번 주 운동 횟수를 비교할 때 이 닉네임이 사용돼요. 식단·운동 상세 기록은 공개되지 않습니다.
        </p>
      </div>

      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <p className="text-sm text-[#6B8079] font-medium">계산된 하루 권장 섭취량</p>
        <p className="text-3xl font-bold mt-1">
          {dailyTarget.calories.toLocaleString()} <span className="text-base font-medium text-[#6B8079]">kcal</span>
        </p>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <MacroStat color="#F2A93B" label="탄수화물" pct={0} grams={dailyTarget.carbs} showPct={false} />
          <MacroStat color="#1F8A70" label="단백질" pct={0} grams={dailyTarget.protein} showPct={false} />
          <MacroStat color="#F16F5C" label="지방" pct={0} grams={dailyTarget.fat} showPct={false} />
        </div>
      </div>

      {/* 체급 비교 (레퍼런스 프로 보디빌더) */}
      <div className="space-y-2">
        <p className="text-sm font-bold text-[#14231F]">내 체중과 비교해보는 프로 선수 체급</p>
        <p className="text-[11px] text-[#6B8079] leading-relaxed">
          체중·체지방률은 대부분 정확한 대회 실측치가 공개되어 있지 않아 알려진 범위 내 근사치를 사용했어요. 사진은 초상권 보호를 위해 앱에 직접 넣지 않았으니, 필요하면 각 선수의 공식 프로필/보도 이미지를 직접 찾아 참고해주세요.
        </p>
        {REFERENCE_ATHLETES.map((athlete) => {
          const leanMass = estimateLeanMass(athlete.weightKg, athlete.bodyFatPct);
          const diff = Math.round((userWeightKg - athlete.weightKg) * 10) / 10;

          return (
            <div
              key={athlete.name}
              className="bg-[#F9FBFA] rounded-xl border border-[#E2ECE8] p-3.5 flex gap-3 items-start shadow-sm"
            >
              <div className="w-11 h-11 rounded-full bg-[#16665A] flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-base">{athlete.name.slice(0, 1)}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">{athlete.name}</p>
                <p className="text-[11px] text-[#6B8079] mt-0.5">{athlete.category}</p>
                <p className="text-xs mt-1.5">
                  {athlete.heightCm}cm · 대회 체중 {athlete.weightKg}kg · 체지방 약 {athlete.bodyFatPct}%
                </p>
                <p className="text-xs mt-0.5">추정 제지방량 약 {leanMass}kg (근육·뼈 등 포함)</p>
                {userWeightKg > 0 && (
                  <p className="text-xs font-semibold text-[#16665A] mt-1">
                    내 체중과 {diff > 0 ? `+${diff}` : diff}kg 차이
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- 기록 히스토리 ----------
function HistoryView({
  meals,
  workouts,
  todayKey,
  goalType,
  dailyTarget,
}: {
  meals: Meal[];
  workouts: Workout[];
  todayKey: string;
  goalType: GoalType;
  dailyTarget: { calories: number; carbs: number; protein: number; fat: number };
}) {
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const dayMeals = meals.filter((m) => m.date === selectedDate);
  const dayWorkouts = workouts.filter((w) => w.date === selectedDate);
  const dayCalories = dayMeals.reduce((sum, m) => sum + m.calories, 0);

  // 최근 7일(오늘 포함) 일별 칼로리/운동 횟수 집계
  const last7Days = useMemo(() => {
    const days: { dateKey: string; calories: number; workoutCount: number; hasMealLog: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dateKey = addDays(todayKey, -i);
      const dayMealsForDate = meals.filter((m) => m.date === dateKey);
      const calories = dayMealsForDate.reduce((sum, m) => sum + m.calories, 0);
      const workoutCount = workouts.filter((w) => w.date === dateKey).length;
      days.push({ dateKey, calories, workoutCount, hasMealLog: dayMealsForDate.length > 0 });
    }
    return days;
  }, [meals, workouts, todayKey]);

  const weeklyAvgCalories = Math.round(last7Days.reduce((sum, d) => sum + d.calories, 0) / 7);
  const weeklyWorkoutCount = last7Days.reduce((sum, d) => sum + d.workoutCount, 0);
  const maxDayCalories = Math.max(...last7Days.map((d) => d.calories), 1);
  const daysWithMealLogs = last7Days.filter((d) => d.hasMealLog).length;

  const last7DaysMeals = useMemo(() => {
    const startDate = addDays(todayKey, -6);
    return meals.filter((m) => m.date >= startDate && m.date <= todayKey);
  }, [meals, todayKey]);

  const macroAverages = useMemo(() => {
    const carbs = last7DaysMeals.reduce((sum, m) => sum + m.carbs, 0);
    const protein = last7DaysMeals.reduce((sum, m) => sum + m.protein, 0);
    const fat = last7DaysMeals.reduce((sum, m) => sum + m.fat, 0);
    return { carbs: Math.round(carbs / 7), protein: Math.round(protein / 7), fat: Math.round(fat / 7) };
  }, [last7DaysMeals]);

  // ---------- AI 주간 리포트 ----------
  const [report, setReport] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function handleGenerateReport() {
    setIsGeneratingReport(true);
    setReportError(null);
    try {
      const res = await fetch("/api/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalType,
          dailyTargetCalories: dailyTarget.calories,
          weeklyAvgCalories,
          weeklyWorkoutCount,
          daysWithMealLogs,
          macroAverages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReportError(data.error || "리포트 생성에 실패했어요.");
        return;
      }
      setReport(data.report);
    } catch {
      setReportError("네트워크 오류로 리포트를 생성하지 못했어요.");
    } finally {
      setIsGeneratingReport(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 날짜 이동 */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-4 shadow-sm flex items-center justify-between">
        <button
          onClick={() => setSelectedDate((d) => addDays(d, -1))}
          className="w-9 h-9 rounded-full bg-[#F4F8F6] flex items-center justify-center text-[#14231F] font-bold"
          aria-label="이전 날"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="text-sm font-bold">{formatDateLabel(selectedDate)}</p>
          {selectedDate === todayKey && <p className="text-[11px] text-[#16665A] font-semibold mt-0.5">오늘</p>}
        </div>
        <button
          onClick={() => setSelectedDate((d) => (d === todayKey ? d : addDays(d, 1)))}
          className="w-9 h-9 rounded-full bg-[#F4F8F6] flex items-center justify-center text-[#14231F] font-bold disabled:opacity-30"
          disabled={selectedDate === todayKey}
          aria-label="다음 날"
        >
          ›
        </button>
      </div>

      {/* 선택한 날의 요약 */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <p className="text-sm text-[#6B8079] font-medium">섭취 칼로리</p>
        <p className="text-2xl font-bold mt-1">
          {dayCalories.toLocaleString()} <span className="text-sm font-medium text-[#6B8079]">kcal</span>
        </p>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <p className="text-xs text-[#6B8079]">식사 {dayMeals.length}건</p>
          <p className="text-xs text-[#6B8079]">운동 {dayWorkouts.length}건</p>
        </div>
      </div>

      {dayMeals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#6B8079]">식사 기록</p>
          {dayMeals.map((m) => (
            <div key={m.id} className="bg-[#F9FBFA] rounded-xl border border-[#E2ECE8] p-3 shadow-sm">
              <p className="text-sm font-semibold">{m.name}</p>
              <p className="text-xs text-[#6B8079] mt-0.5">
                {m.quantity} · {m.calories}kcal
              </p>
            </div>
          ))}
        </div>
      )}

      {dayWorkouts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#6B8079]">운동 기록</p>
          {dayWorkouts.map((w) => (
            <div key={w.id} className="bg-[#F9FBFA] rounded-xl border border-[#E2ECE8] p-3 shadow-sm">
              <p className="text-sm font-semibold">{w.name}</p>
              <p className="text-xs text-[#6B8079] mt-0.5">
                {w.sets}세트 · {w.weight}kg · {w.reps}회
              </p>
            </div>
          ))}
        </div>
      )}

      {dayMeals.length === 0 && dayWorkouts.length === 0 && <EmptyState text="이 날짜에는 기록이 없어요." />}

      {/* 최근 7일 주간 요약 */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <p className="text-sm font-bold mb-1">최근 7일 요약</p>
        <p className="text-xs text-[#6B8079] mb-4">
          일평균 {weeklyAvgCalories.toLocaleString()}kcal · 운동 {weeklyWorkoutCount}회
        </p>
        <div className="flex items-end justify-between gap-2 h-28">
          {last7Days.map((d) => {
            const barHeightPct = Math.max((d.calories / maxDayCalories) * 100, d.calories > 0 ? 6 : 2);
            const isToday = d.dateKey === todayKey;
            const dayLabel = new Date(`${d.dateKey}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" });
            return (
              <div key={d.dateKey} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                <div
                  className={`w-full rounded-t-md ${isToday ? "bg-[#16665A]" : "bg-[#F2A93B]"}`}
                  style={{ height: `${barHeightPct}%` }}
                />
                <span className={`text-[10px] ${isToday ? "font-bold text-[#16665A]" : "text-[#6B8079]"}`}>{dayLabel}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI 주간 리포트 */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <p className="text-sm font-bold mb-1">🤖 AI 주간 코칭 리포트</p>
        <p className="text-xs text-[#6B8079] mb-3">이번 주 기록을 바탕으로 짧은 코칭 메시지를 받아보세요.</p>

        {report && !isGeneratingReport && (
          <p className="text-sm leading-relaxed text-[#14231F] bg-[#F4F8F6] rounded-xl p-4 mb-3">{report}</p>
        )}
        {reportError && <p className="text-xs text-[#F16F5C] mb-3">{reportError}</p>}

        <button
          onClick={handleGenerateReport}
          disabled={isGeneratingReport}
          className="w-full bg-[#16665A] text-white font-semibold py-2.5 rounded-xl active:opacity-80 transition-opacity disabled:opacity-50"
        >
          {isGeneratingReport ? "리포트 생성 중..." : report ? "리포트 새로 받기" : "이번 주 리포트 받기"}
        </button>
      </div>
    </div>
  );
}

// ---------- 주간 랭킹 (소셜 챌린지) ----------
function RankingView() {
  const [rows, setRows] = useState<{ display_name: string; workout_count: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const { data, error: rpcError } = await supabase.rpc("get_weekly_leaderboard");
      if (cancelled) return;
      if (rpcError) {
        setError("랭킹을 불러오지 못했어요.");
      } else {
        setRows(data || []);
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-5 shadow-sm">
        <p className="text-sm font-bold">🏆 이번 주 운동 챌린지</p>
        <p className="text-xs text-[#6B8079] mt-1">최근 7일간 운동을 가장 많이 기록한 순서예요. 식단·운동 상세 내용은 공개되지 않아요.</p>
      </div>

      {isLoading && <p className="text-xs text-[#6B8079] text-center py-6">불러오는 중...</p>}
      {error && <p className="text-xs text-[#F16F5C] text-center py-6">{error}</p>}

      {!isLoading && !error && rows && rows.length === 0 && (
        <EmptyState text="아직 이번 주 운동 기록이 없어요. 첫 번째로 랭킹에 이름을 올려보세요!" />
      )}

      {!isLoading &&
        !error &&
        rows &&
        rows.map((row, idx) => (
          <div key={idx} className="bg-[#F9FBFA] rounded-xl border border-[#E2ECE8] p-3.5 flex items-center gap-3 shadow-sm">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                idx === 0 ? "bg-[#F2A93B] text-white" : idx === 1 ? "bg-[#B9C4C0] text-white" : idx === 2 ? "bg-[#C98A5B] text-white" : "bg-[#F4F8F6] text-[#6B8079]"
              }`}
            >
              {idx + 1}
            </div>
            <p className="flex-1 text-sm font-semibold">{row.display_name}</p>
            <p className="text-sm font-bold text-[#16665A]">{row.workout_count}회</p>
          </div>
        ))}
    </div>
  );
}

// ---------- 추천 콘텐츠 (운동 영상/음악) ----------
function RecommendView() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-bold mb-2">🎥 추천 운동 영상</p>
        <div className="space-y-2">
          {RECOMMENDED_VIDEOS.map((v) => (
            <a
              key={v.url}
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-[#F9FBFA] rounded-xl border border-[#E2ECE8] p-3.5 shadow-sm active:opacity-80 transition-opacity"
            >
              <p className="text-sm font-semibold">{v.title}</p>
              <p className="text-xs text-[#6B8079] mt-0.5">{v.source}</p>
            </a>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-bold mb-2">🎵 추천 운동 플레이리스트</p>
        <div className="space-y-2">
          {RECOMMENDED_PLAYLISTS.map((p) => (
            <a
              key={p.url}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-[#F9FBFA] rounded-xl border border-[#E2ECE8] p-3.5 shadow-sm active:opacity-80 transition-opacity"
            >
              <p className="text-sm font-semibold">{p.title}</p>
              <p className="text-xs text-[#6B8079] mt-0.5">{p.source}</p>
            </a>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-[#6B8079] leading-relaxed">
        탭하면 유튜브/스포티파이 앱 또는 웹사이트로 이동해요. 채널이 개편되거나 재생목록이 바뀔 수 있으니, 콘텐츠가 마음에 들면 즐겨찾기/구독해두는 걸 추천해요.
      </p>
    </div>
  );
}

// ---------- 커뮤니티 (사진 게시글 + 댓글) ----------
type Post = { id: string; user_id: string; display_name: string; image_url: string; caption: string; created_at: string };
type CommentRow = { id: string; post_id: string; user_id: string; display_name: string; content: string; created_at: string };

function CommunityView({
  session,
  displayName,
  onRequireAuth,
}: {
  session: Session | null;
  displayName: string;
  onRequireAuth: () => void;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [caption, setCaption] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, CommentRow[]>>({});
  const [newCommentByPost, setNewCommentByPost] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      setIsLoadingPosts(true);
      const { data } = await supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(50);
      setPosts(data || []);
      setIsLoadingPosts(false);
    })();
  }, []);

  async function handleUploadPost() {
    if (!selectedFile) return;
    if (!session) {
      onRequireAuth();
      return;
    }
    setIsUploading(true);
    setUploadError(null);

    try {
      const path = `${session.user.id}/${Date.now()}-${selectedFile.name}`;
      const { error: uploadErr } = await supabase.storage.from("post-images").upload(path, selectedFile);
      if (uploadErr) {
        setUploadError("이미지 업로드에 실패했어요.");
        return;
      }
      const { data: urlData } = supabase.storage.from("post-images").getPublicUrl(path);

      const { data, error: insertErr } = await supabase
        .from("posts")
        .insert({
          user_id: session.user.id,
          display_name: displayName || "익명 유저",
          image_url: urlData.publicUrl,
          caption: caption.trim(),
        })
        .select()
        .single();

      if (insertErr || !data) {
        setUploadError("게시글 등록에 실패했어요.");
        return;
      }

      setPosts((prev) => [data, ...prev]);
      setCaption("");
      setSelectedFile(null);
    } catch {
      setUploadError("네트워크 오류가 발생했어요.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeletePost(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("posts").delete().eq("id", id);
  }

  async function toggleComments(postId: string) {
    if (expandedPostId === postId) {
      setExpandedPostId(null);
      return;
    }
    setExpandedPostId(postId);
    if (!commentsByPost[postId]) {
      const { data } = await supabase.from("comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
      setCommentsByPost((prev) => ({ ...prev, [postId]: data || [] }));
    }
  }

  async function handleAddComment(postId: string) {
    if (!session) {
      onRequireAuth();
      return;
    }
    const content = (newCommentByPost[postId] || "").trim();
    if (!content) return;

    const { data, error } = await supabase
      .from("comments")
      .insert({ post_id: postId, user_id: session.user.id, display_name: displayName || "익명 유저", content })
      .select()
      .single();

    if (!error && data) {
      setCommentsByPost((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), data] }));
      setNewCommentByPost((prev) => ({ ...prev, [postId]: "" }));
    }
  }

  return (
    <div className="space-y-4">
      {!session && (
        <div className="bg-[#F9FBFA] border border-[#E2ECE8] rounded-xl px-4 py-3">
          <p className="text-xs text-[#6B8079] leading-relaxed">
            둘러보기 모드에서는 게시글/댓글을 남길 수 없어요.{" "}
            <button onClick={onRequireAuth} className="text-[#16665A] font-semibold underline underline-offset-2">
              로그인
            </button>
            하면 참여할 수 있어요.
          </p>
        </div>
      )}

      {/* 게시글 작성 */}
      <div className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] p-4 shadow-sm space-y-3">
        <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-[#E2ECE8] rounded-xl py-4 cursor-pointer active:bg-[#F4F8F6] transition-colors">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          />
          <span className="text-xl">📷</span>
          <span className="text-sm font-semibold text-[#16665A]">{selectedFile ? selectedFile.name : "사진 선택하기"}</span>
        </label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="오늘의 운동/식단 이야기를 남겨보세요"
          className="w-full rounded-lg border border-[#E2ECE8] px-3 py-2 text-sm outline-none focus:border-[#16665A] focus:ring-2 focus:ring-[#16665A]/20 resize-none"
          rows={2}
        />
        {uploadError && <p className="text-xs text-[#F16F5C]">{uploadError}</p>}
        <button
          onClick={handleUploadPost}
          disabled={!selectedFile || isUploading}
          className="w-full bg-[#16665A] text-white font-semibold py-2.5 rounded-xl active:opacity-80 transition-opacity disabled:opacity-50"
        >
          {isUploading ? "올리는 중..." : "게시하기"}
        </button>
      </div>

      {/* 피드 */}
      {isLoadingPosts && <p className="text-xs text-[#6B8079] text-center py-6">불러오는 중...</p>}
      {!isLoadingPosts && posts.length === 0 && <EmptyState text="아직 게시글이 없어요. 첫 게시글을 올려보세요!" />}

      {!isLoadingPosts &&
        posts.map((post) => (
          <div key={post.id} className="bg-[#F9FBFA] rounded-2xl border border-[#E2ECE8] shadow-sm overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.image_url} alt={post.caption || "게시글 이미지"} className="w-full aspect-square object-cover" />
            <div className="p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{post.display_name}</p>
                {session?.user.id === post.user_id && (
                  <button onClick={() => handleDeletePost(post.id)} className="text-xs text-[#F16F5C] font-medium">
                    삭제
                  </button>
                )}
              </div>
              {post.caption && <p className="text-sm text-[#14231F] mt-1.5">{post.caption}</p>}
              <button
                onClick={() => toggleComments(post.id)}
                className="text-xs text-[#6B8079] font-medium mt-2"
              >
                💬 댓글 {commentsByPost[post.id]?.length ?? ""} {expandedPostId === post.id ? "숨기기" : "보기/작성"}
              </button>

              {expandedPostId === post.id && (
                <div className="mt-3 space-y-2 border-t border-[#E2ECE8] pt-3">
                  {(commentsByPost[post.id] || []).map((c) => (
                    <div key={c.id}>
                      <span className="text-xs font-semibold">{c.display_name}</span>{" "}
                      <span className="text-xs text-[#14231F]">{c.content}</span>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={newCommentByPost[post.id] || ""}
                      onChange={(e) => setNewCommentByPost((prev) => ({ ...prev, [post.id]: e.target.value }))}
                      placeholder="댓글 달기..."
                      className="flex-1 rounded-lg border border-[#E2ECE8] px-3 py-1.5 text-xs outline-none focus:border-[#16665A]"
                    />
                    <button
                      onClick={() => handleAddComment(post.id)}
                      className="text-xs font-semibold text-[#16665A] px-2"
                    >
                      등록
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

// ---------- 사진 파일 → base64 변환 유틸 ----------
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // "data:image/jpeg;base64,XXXX" 형태에서 base64 부분만 추출
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

// ---------- 공통 컴포넌트 ----------
function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[#6B8079]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-[#E2ECE8] bg-[#F9FBFA] px-3 py-2 text-sm text-[#14231F] outline-none focus:border-[#16665A] focus:ring-2 focus:ring-[#16665A]/20"
      />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-[#F9FBFA] rounded-xl border border-dashed border-[#E2ECE8] p-6 text-center">
      <p className="text-sm text-[#6B8079]">{text}</p>
    </div>
  );
}
