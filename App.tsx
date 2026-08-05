import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
// 사진 인식을 위해 expo-image-picker 필요: npx expo install expo-image-picker
import * as ImagePicker from "expo-image-picker";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
// 웨어러블(HealthKit) 연동 - iOS 전용, Expo Go에서는 동작하지 않음 (자세한 내용은 lib/health.ts 참고)
import { isHealthKitAvailable, requestHealthKitPermissions, fetchTodaySteps, fetchTodayActiveEnergy } from "./lib/health";

// ---------- 백엔드 설정 ----------
// 웹(Next.js) 버전에 만든 /api/analyze-food 라우트를 배포한 뒤, 그 도메인을 여기에 입력하세요.
// 예: "https://your-app.vercel.app"
const API_BASE_URL = "https://YOUR-DEPLOYED-DOMAIN.example.com";

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

type GoalType = "loss" | "maintain" | "gain";

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

// ---------- 색상 토큰 ----------
const COLORS = {
  bg: "#F4F8F6",
  card: "#FFFFFF",
  border: "#E2ECE8",
  primary: "#16665A",
  carb: "#F2A93B",
  protein: "#1F8A70",
  fat: "#F16F5C",
  text: "#14231F",
  muted: "#6B8079",
};

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


// ---------- 로그인 / 회원가입 ----------
function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
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
    <SafeAreaView style={[styles.safeArea, { justifyContent: "center", paddingHorizontal: 24 }]}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.muted, textAlign: "center" }}>헬스케어 앱</Text>
      <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text, textAlign: "center", marginTop: 4, marginBottom: 24 }}>
        {mode === "signin" ? "로그인" : "회원가입"}
      </Text>

      <View style={styles.card}>
        <Input label="이메일" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
        <Input label="비밀번호" value={password} onChangeText={setPassword} placeholder="6자 이상" secureTextEntry autoCapitalize="none" />

        {error && <Text style={{ fontSize: 12, color: COLORS.fat, marginBottom: 8 }}>{error}</Text>}
        {info && <Text style={{ fontSize: 12, color: COLORS.primary, marginBottom: 8 }}>{info}</Text>}

        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} activeOpacity={0.85} disabled={isSubmitting}>
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitButtonText}>{mode === "signin" ? "로그인" : "회원가입"}</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={() => {
          setMode((m) => (m === "signin" ? "signup" : "signin"));
          setError(null);
          setInfo(null);
        }}
        style={{ marginTop: 16 }}
      >
        <Text style={{ fontSize: 12, color: COLORS.muted, fontWeight: "600", textAlign: "center" }}>
          {mode === "signin" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [todayKey] = useState<string>(() => toDateKey(new Date()));

  // ---------- 인증 ----------
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

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
          mealsRes.data.map((r: any) => ({
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
          workoutsRes.data.map((r: any) => ({
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
    const macroTotalKcal = carbsKcal + proteinKcal + fatKcal || 1;

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

  const todayLabel = new Date().toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const titleMap: Record<Tab, string> = {
    home: "오늘의 요약",
    meal: "식단 관리",
    workout: "운동 관리",
    goal: "목표 설정",
    history: "기록 히스토리",
    ranking: "주간 랭킹",
    recommend: "추천 콘텐츠",
    community: "커뮤니티",
  };

  if (!authChecked) {
    return (
      <SafeAreaView style={[styles.safeArea, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 8 }}>불러오는 중...</Text>
      </SafeAreaView>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!dataLoaded) {
    return (
      <SafeAreaView style={[styles.safeArea, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 8 }}>데이터를 불러오는 중...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <View style={[styles.header, { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }]}>
        <View>
          <Text style={styles.dateText}>{todayLabel}</Text>
          <Text style={styles.titleText}>{titleMap[activeTab]}</Text>
        </View>
        <TouchableOpacity onPress={() => supabase.auth.signOut()}>
          <Text style={{ fontSize: 12, color: COLORS.muted, fontWeight: "600", marginTop: 4 }}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === "home" && (
          <HomeView summary={summary} mealsCount={todayMeals.length} workoutsCount={todayWorkouts.length} dailyTarget={dailyTarget} />
        )}
        {activeTab === "meal" && <MealView meals={todayMeals} onAdd={addMeal} onDelete={deleteMeal} todayKey={todayKey} />}
        {activeTab === "workout" && (
          <WorkoutView workouts={todayWorkouts} onAdd={addWorkout} onDelete={deleteWorkout} todayKey={todayKey} />
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
          />
        )}
        {activeTab === "history" && (
          <HistoryView meals={meals} workouts={workouts} todayKey={todayKey} goalType={goalType} dailyTarget={dailyTarget} />
        )}
        {activeTab === "ranking" && <RankingView />}
        {activeTab === "recommend" && <RecommendView />}
        {activeTab === "community" && <CommunityView session={session} displayName={displayName} />}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={{ paddingHorizontal: 4 }}>
        <TabButton label="홈" icon="🏠" active={activeTab === "home"} onPress={() => setActiveTab("home")} />
        <TabButton label="식단" icon="🍽️" active={activeTab === "meal"} onPress={() => setActiveTab("meal")} />
        <TabButton label="운동" icon="🏋️" active={activeTab === "workout"} onPress={() => setActiveTab("workout")} />
        <TabButton label="목표" icon="🎯" active={activeTab === "goal"} onPress={() => setActiveTab("goal")} />
        <TabButton label="기록" icon="📅" active={activeTab === "history"} onPress={() => setActiveTab("history")} />
        <TabButton label="랭킹" icon="🏆" active={activeTab === "ranking"} onPress={() => setActiveTab("ranking")} />
        <TabButton label="추천" icon="🎵" active={activeTab === "recommend"} onPress={() => setActiveTab("recommend")} />
        <TabButton label="커뮤니티" icon="👥" active={activeTab === "community"} onPress={() => setActiveTab("community")} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- 하단 탭 버튼 ----------
function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.tabButton} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.tabIcon}>{icon}</Text>
      <Text style={[styles.tabLabel, { color: active ? COLORS.primary : COLORS.muted, fontWeight: active ? "700" : "500" }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ---------- 홈(대시보드) ----------
function HomeView({
  summary,
  mealsCount,
  workoutsCount,
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
  mealsCount: number;
  workoutsCount: number;
  dailyTarget: { calories: number; carbs: number; protein: number; fat: number };
}) {
  return (
    <View style={{ gap: 12 }}>
      {/* 칼로리 요약 카드 */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>오늘 섭취 칼로리</Text>
        <Text style={styles.bigNumber}>
          {summary.totalCalories.toLocaleString()} <Text style={styles.unitText}>kcal</Text>
        </Text>
      </View>

      {/* 탄단지 비율 카드 */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>탄수화물 · 단백질 · 지방 비율</Text>
        <View style={styles.stackBarTrack}>
          <View style={[styles.stackBarSegment, { flex: summary.carbsPct || 0.0001, backgroundColor: COLORS.carb }]} />
          <View style={[styles.stackBarSegment, { flex: summary.proteinPct || 0.0001, backgroundColor: COLORS.protein }]} />
          <View style={[styles.stackBarSegment, { flex: summary.fatPct || 0.0001, backgroundColor: COLORS.fat }]} />
        </View>
        <View style={styles.macroRow}>
          <MacroStat color={COLORS.carb} label="탄수화물" pct={summary.carbsPct} grams={summary.carbsG} />
          <MacroStat color={COLORS.protein} label="단백질" pct={summary.proteinPct} grams={summary.proteinG} />
          <MacroStat color={COLORS.fat} label="지방" pct={summary.fatPct} grams={summary.fatG} />
        </View>
      </View>

      {/* 하루 권장 섭취량 대비 */}
      <View style={styles.card}>
        <View style={styles.targetHeaderRow}>
          <Text style={styles.cardLabel}>하루 권장 섭취량 대비</Text>
          <Text style={styles.targetSubLabel}>{dailyTarget.calories.toLocaleString()}kcal 목표</Text>
        </View>
        <View style={{ gap: 10, marginTop: 6 }}>
          <TargetBar label="칼로리" color={COLORS.primary} actual={summary.totalCalories} target={dailyTarget.calories} unit="kcal" />
          <TargetBar label="탄수화물" color={COLORS.carb} actual={summary.carbsG} target={dailyTarget.carbs} unit="g" />
          <TargetBar label="단백질" color={COLORS.protein} actual={summary.proteinG} target={dailyTarget.protein} unit="g" />
          <TargetBar label="지방" color={COLORS.fat} actual={summary.fatG} target={dailyTarget.fat} unit="g" />
        </View>
      </View>

      {/* 웨어러블(HealthKit) 활동량 카드 */}
      <WearableActivityCard />

      {/* 간단 현황 */}
      <View style={styles.statRow}>
        <View style={[styles.card, styles.statCard]}>
          <Text style={styles.statLabel}>기록된 식사</Text>
          <Text style={styles.statNumber}>{mealsCount}건</Text>
        </View>
        <View style={[styles.card, styles.statCard]}>
          <Text style={styles.statLabel}>기록된 운동</Text>
          <Text style={styles.statNumber}>{workoutsCount}건</Text>
        </View>
      </View>
    </View>
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
    <View style={{ alignItems: "center", flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Text style={styles.macroLabel}>{label}</Text>
      </View>
      {showPct && <Text style={styles.macroPct}>{pct}%</Text>}
      <Text style={styles.macroGrams}>{grams}g</Text>
    </View>
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
  const barWidth = Math.min(Math.max(pct, 0), 100);

  return (
    <View>
      <View style={styles.targetBarLabelRow}>
        <Text style={styles.targetBarLabel}>{label}</Text>
        <Text style={styles.targetBarValue}>
          {actual.toLocaleString()} / {target.toLocaleString()}
          {unit} <Text style={{ fontWeight: "700", color: COLORS.text }}>({pct}%)</Text>
        </Text>
      </View>
      <View style={styles.targetBarTrack}>
        <View style={{ width: `${barWidth}%`, height: "100%", borderRadius: 999, backgroundColor: color }} />
      </View>
    </View>
  );
}

// ---------- 웨어러블(Apple HealthKit) 활동량 카드 ----------
// iOS 전용, Expo Go에서는 동작하지 않습니다. 자세한 제약사항은 lib/health.ts 상단 주석을 참고하세요.
function WearableActivityCard() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "unavailable">("idle");
  const [steps, setSteps] = useState(0);
  const [activeEnergy, setActiveEnergy] = useState(0);

  async function handleConnect() {
    if (!isHealthKitAvailable()) {
      setStatus("unavailable");
      return;
    }
    setStatus("connecting");
    const granted = await requestHealthKitPermissions();
    if (!granted) {
      setStatus("unavailable");
      return;
    }
    const [stepsResult, energyResult] = await Promise.all([fetchTodaySteps(), fetchTodayActiveEnergy()]);
    setSteps(stepsResult);
    setActiveEnergy(energyResult);
    setStatus("connected");
  }

  if (status === "connected") {
    return (
      <View style={styles.card}>
        <Text style={styles.cardLabel}>오늘 활동량 (Apple 건강 앱)</Text>
        <View style={{ flexDirection: "row", gap: 20, marginTop: 8 }}>
          <View>
            <Text style={styles.bigNumber}>{steps.toLocaleString()}</Text>
            <Text style={styles.unitText}>걸음</Text>
          </View>
          <View>
            <Text style={styles.bigNumber}>{activeEnergy.toLocaleString()}</Text>
            <Text style={styles.unitText}>kcal 활동 소모</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>오늘 활동량</Text>
      <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 4, marginBottom: 10, lineHeight: 18 }}>
        {status === "unavailable"
          ? "이 기기/환경에서는 Apple 건강 앱 연동을 사용할 수 없어요. (iOS 실기기 + 커스텀 개발 빌드 필요, Expo Go 미지원)"
          : "Apple 건강 앱과 연동하면 걸음 수·활동 칼로리를 자동으로 가져와요."}
      </Text>
      {status !== "unavailable" && (
        <TouchableOpacity style={styles.submitButton} onPress={handleConnect} activeOpacity={0.85} disabled={status === "connecting"}>
          {status === "connecting" ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitButtonText}>건강 앱 연동하기</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---------- 식단 관리 ----------
function MealView({
  meals,
  onAdd,
  onDelete,
  todayKey,
}: {
  meals: Meal[];
  onAdd: (input: Omit<Meal, "id">) => void;
  onDelete: (id: string) => void;
  todayKey: string;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [calories, setCalories] = useState("");
  const [carbs, setCarbs] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");

  // ---------- 사진 인식 ----------
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<string | null>(null);

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("카메라 권한이 필요해요", "설정에서 카메라 접근을 허용해주세요.");
      return;
    }

    const picked = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.6,
      allowsEditing: true,
    });
    if (picked.canceled || !picked.assets?.[0]?.base64) return;

    const asset = picked.assets[0];
    setIsAnalyzing(true);
    setAiConfidence(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/analyze-food`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: asset.base64, mediaType: "image/jpeg" }),
      });
      const data = await res.json();

      if (!res.ok) {
        Alert.alert("인식 실패", data.error || "다시 시도해주세요.");
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
      Alert.alert("인식 실패", "네트워크 오류로 인식하지 못했어요.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleSubmit() {
    if (!name.trim() || !calories) return;
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
    <View style={{ gap: 16 }}>
      <View style={styles.card}>
        <TouchableOpacity style={styles.photoButton} onPress={handlePickPhoto} activeOpacity={0.85} disabled={isAnalyzing}>
          {isAnalyzing ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : (
            <>
              <Text style={{ fontSize: 20 }}>📷</Text>
              <Text style={styles.photoButtonText}>사진으로 음식 인식하기</Text>
            </>
          )}
        </TouchableOpacity>
        {aiConfidence && (
          <Text style={styles.goalHint}>
            AI가 인식한 초안이에요 (신뢰도: {aiConfidence === "high" ? "높음" : aiConfidence === "medium" ? "보통" : "낮음"}). 아래에서 값을 확인하고 추가해주세요.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.formRow}>
          <Input label="음식명" value={name} onChangeText={setName} placeholder="예: 현미밥" style={{ flex: 1 }} />
          <Input label="수량" value={quantity} onChangeText={setQuantity} placeholder="예: 1공기" style={{ flex: 1 }} />
        </View>
        <Input label="칼로리 (kcal)" value={calories} onChangeText={setCalories} placeholder="예: 300" keyboardType="numeric" />
        <View style={styles.formRow}>
          <Input label="탄수화물(g)" value={carbs} onChangeText={setCarbs} placeholder="0" keyboardType="numeric" style={{ flex: 1 }} />
          <Input label="단백질(g)" value={protein} onChangeText={setProtein} placeholder="0" keyboardType="numeric" style={{ flex: 1 }} />
          <Input label="지방(g)" value={fat} onChangeText={setFat} placeholder="0" keyboardType="numeric" style={{ flex: 1 }} />
        </View>
        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} activeOpacity={0.85}>
          <Text style={styles.submitButtonText}>식사 기록 추가</Text>
        </TouchableOpacity>
      </View>

      <View style={{ gap: 8 }}>
        {meals.length === 0 && <EmptyState text="아직 기록된 식사가 없어요. 위에서 추가해보세요." />}
        {meals.map((meal) => (
          <View key={meal.id} style={styles.listItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listItemTitle}>{meal.name}</Text>
              <Text style={styles.listItemSub}>
                {meal.quantity} · {meal.calories}kcal · 탄{meal.carbs} 단{meal.protein} 지{meal.fat}
              </Text>
            </View>
            <TouchableOpacity onPress={() => handleDelete(meal.id)} hitSlop={8}>
              <Text style={styles.deleteText}>삭제</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------- 운동 관리 ----------
function WorkoutView({
  workouts,
  onAdd,
  onDelete,
  todayKey,
}: {
  workouts: Workout[];
  onAdd: (input: Omit<Workout, "id">) => void;
  onDelete: (id: string) => void;
  todayKey: string;
}) {
  const [name, setName] = useState("");
  const [sets, setSets] = useState("");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");

  function handleSubmit() {
    if (!name.trim() || !sets) return;
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
    <View style={{ gap: 16 }}>
      <View style={styles.card}>
        <Input label="종목" value={name} onChangeText={setName} placeholder="예: 벤치프레스" />
        <View style={styles.formRow}>
          <Input label="세트" value={sets} onChangeText={setSets} placeholder="0" keyboardType="numeric" style={{ flex: 1 }} />
          <Input label="무게(kg)" value={weight} onChangeText={setWeight} placeholder="0" keyboardType="numeric" style={{ flex: 1 }} />
          <Input label="횟수" value={reps} onChangeText={setReps} placeholder="0" keyboardType="numeric" style={{ flex: 1 }} />
        </View>
        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} activeOpacity={0.85}>
          <Text style={styles.submitButtonText}>운동 기록 추가</Text>
        </TouchableOpacity>
      </View>

      <View style={{ gap: 8 }}>
        {workouts.length === 0 && <EmptyState text="아직 기록된 운동이 없어요. 위에서 추가해보세요." />}
        {workouts.map((w) => (
          <View key={w.id} style={styles.listItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listItemTitle}>{w.name}</Text>
              <Text style={styles.listItemSub}>
                {w.sets}세트 · {w.weight}kg · {w.reps}회
              </Text>
            </View>
            <TouchableOpacity onPress={() => handleDelete(w.id)} hitSlop={8}>
              <Text style={styles.deleteText}>삭제</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
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
      const res = await fetch(`${API_BASE_URL}/api/weekly-report`, {
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
    <View style={{ gap: 16 }}>
      {/* 날짜 이동 */}
      <View style={[styles.card, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <TouchableOpacity style={styles.dateNavButton} onPress={() => setSelectedDate((d) => addDays(d, -1))}>
          <Text style={styles.dateNavButtonText}>‹</Text>
        </TouchableOpacity>
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: COLORS.text }}>{formatDateLabel(selectedDate)}</Text>
          {selectedDate === todayKey && <Text style={{ fontSize: 11, fontWeight: "700", color: COLORS.primary, marginTop: 2 }}>오늘</Text>}
        </View>
        <TouchableOpacity
          style={[styles.dateNavButton, selectedDate === todayKey && { opacity: 0.3 }]}
          onPress={() => setSelectedDate((d) => (d === todayKey ? d : addDays(d, 1)))}
          disabled={selectedDate === todayKey}
        >
          <Text style={styles.dateNavButtonText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* 선택한 날의 요약 */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>섭취 칼로리</Text>
        <Text style={styles.bigNumber}>
          {dayCalories.toLocaleString()} <Text style={styles.unitText}>kcal</Text>
        </Text>
        <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
          <Text style={{ fontSize: 12, color: COLORS.muted }}>식사 {dayMeals.length}건</Text>
          <Text style={{ fontSize: 12, color: COLORS.muted }}>운동 {dayWorkouts.length}건</Text>
        </View>
      </View>

      {dayMeals.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={styles.sectionTitle}>식사 기록</Text>
          {dayMeals.map((m) => (
            <View key={m.id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listItemTitle}>{m.name}</Text>
                <Text style={styles.listItemSub}>{m.quantity} · {m.calories}kcal</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {dayWorkouts.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={styles.sectionTitle}>운동 기록</Text>
          {dayWorkouts.map((w) => (
            <View key={w.id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listItemTitle}>{w.name}</Text>
                <Text style={styles.listItemSub}>{w.sets}세트 · {w.weight}kg · {w.reps}회</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {dayMeals.length === 0 && dayWorkouts.length === 0 && <EmptyState text="이 날짜에는 기록이 없어요." />}

      {/* 최근 7일 요약 */}
      <View style={styles.card}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: COLORS.text }}>최근 7일 요약</Text>
        <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 2, marginBottom: 14 }}>
          일평균 {weeklyAvgCalories.toLocaleString()}kcal · 운동 {weeklyWorkoutCount}회
        </Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 110, gap: 6 }}>
          {last7Days.map((d) => {
            const barHeightPct = Math.max((d.calories / maxDayCalories) * 100, d.calories > 0 ? 6 : 2);
            const isToday = d.dateKey === todayKey;
            const dayLabel = new Date(`${d.dateKey}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" });
            return (
              <View key={d.dateKey} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 6 }}>
                <View
                  style={{
                    width: "100%",
                    height: `${barHeightPct}%`,
                    borderRadius: 4,
                    backgroundColor: isToday ? COLORS.primary : COLORS.carb,
                  }}
                />
                <Text style={{ fontSize: 10, fontWeight: isToday ? "700" : "500", color: isToday ? COLORS.primary : COLORS.muted }}>
                  {dayLabel}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* AI 주간 리포트 */}
      <View style={styles.card}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: COLORS.text }}>🤖 AI 주간 코칭 리포트</Text>
        <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 2, marginBottom: 12 }}>
          이번 주 기록을 바탕으로 짧은 코칭 메시지를 받아보세요.
        </Text>

        {report && !isGeneratingReport && (
          <View style={{ backgroundColor: COLORS.bg, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <Text style={{ fontSize: 13, lineHeight: 20, color: COLORS.text }}>{report}</Text>
          </View>
        )}
        {reportError && <Text style={{ fontSize: 12, color: COLORS.fat, marginBottom: 12 }}>{reportError}</Text>}

        <TouchableOpacity style={styles.submitButton} onPress={handleGenerateReport} activeOpacity={0.85} disabled={isGeneratingReport}>
          {isGeneratingReport ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitButtonText}>{report ? "리포트 새로 받기" : "이번 주 리포트 받기"}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
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
    <View style={{ gap: 12 }}>
      <View style={styles.card}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: COLORS.text }}>🏆 이번 주 운동 챌린지</Text>
        <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
          최근 7일간 운동을 가장 많이 기록한 순서예요. 식단·운동 상세 내용은 공개되지 않아요.
        </Text>
      </View>

      {isLoading && <Text style={{ fontSize: 12, color: COLORS.muted, textAlign: "center", paddingVertical: 20 }}>불러오는 중...</Text>}
      {error && <Text style={{ fontSize: 12, color: COLORS.fat, textAlign: "center", paddingVertical: 20 }}>{error}</Text>}

      {!isLoading && !error && rows && rows.length === 0 && (
        <EmptyState text="아직 이번 주 운동 기록이 없어요. 첫 번째로 랭킹에 이름을 올려보세요!" />
      )}

      {!isLoading &&
        !error &&
        rows &&
        rows.map((row, idx) => {
          const badgeColor = idx === 0 ? COLORS.carb : idx === 1 ? "#B9C4C0" : idx === 2 ? "#C98A5B" : COLORS.bg;
          const badgeTextColor = idx <= 2 ? "#FFFFFF" : COLORS.muted;
          return (
            <View key={idx} style={[styles.listItem, { alignItems: "center" }]}>
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: badgeColor,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 10,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: badgeTextColor }}>{idx + 1}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: COLORS.text }}>{row.display_name}</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: COLORS.primary }}>{row.workout_count}회</Text>
            </View>
          );
        })}
    </View>
  );
}

// ---------- 추천 콘텐츠 (운동 영상/음악) ----------
function RecommendView() {
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Text style={styles.sectionTitle}>🎥 추천 운동 영상</Text>
        {RECOMMENDED_VIDEOS.map((v) => (
          <TouchableOpacity key={v.url} style={styles.listItem} onPress={() => Linking.openURL(v.url)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listItemTitle}>{v.title}</Text>
              <Text style={styles.listItemSub}>{v.source}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.sectionTitle}>🎵 추천 운동 플레이리스트</Text>
        {RECOMMENDED_PLAYLISTS.map((p) => (
          <TouchableOpacity key={p.url} style={styles.listItem} onPress={() => Linking.openURL(p.url)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listItemTitle}>{p.title}</Text>
              <Text style={styles.listItemSub}>{p.source}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={{ fontSize: 11, color: COLORS.muted, lineHeight: 16 }}>
        탭하면 유튜브/스포티파이 앱 또는 웹사이트로 이동해요. 채널이 개편되거나 재생목록이 바뀔 수 있으니, 콘텐츠가 마음에 들면 즐겨찾기/구독해두는 걸 추천해요.
      </Text>
    </View>
  );
}

// ---------- 커뮤니티 (사진 게시글 + 댓글) ----------
type Post = { id: string; user_id: string; display_name: string; image_url: string; caption: string; created_at: string };
type CommentRow = { id: string; post_id: string; user_id: string; display_name: string; content: string; created_at: string };

function CommunityView({ session, displayName }: { session: Session | null; displayName: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [caption, setCaption] = useState("");
  const [selectedImage, setSelectedImage] = useState<{ uri: string; fileName: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

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

  async function handlePickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("사진 접근 권한이 필요해요", "설정에서 사진 라이브러리 접근을 허용해주세요.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsEditing: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setSelectedImage({ uri: asset.uri, fileName: asset.fileName || `photo-${Date.now()}.jpg` });
  }

  async function handleUploadPost() {
    if (!session || !selectedImage) return;
    setIsUploading(true);

    try {
      const response = await fetch(selectedImage.uri);
      const blob = await response.blob();
      const path = `${session.user.id}/${Date.now()}-${selectedImage.fileName}`;

      const { error: uploadErr } = await supabase.storage.from("post-images").upload(path, blob, { contentType: "image/jpeg" });
      if (uploadErr) {
        Alert.alert("업로드 실패", "이미지 업로드에 실패했어요.");
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
        Alert.alert("등록 실패", "게시글 등록에 실패했어요.");
        return;
      }

      setPosts((prev) => [data, ...prev]);
      setCaption("");
      setSelectedImage(null);
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했어요.");
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
    if (!session) return;
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
    <View style={{ gap: 16 }}>
      {/* 게시글 작성 */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.photoButton} onPress={handlePickImage} activeOpacity={0.85}>
          <Text style={{ fontSize: 20 }}>📷</Text>
          <Text style={styles.photoButtonText}>{selectedImage ? "사진 변경하기" : "사진 선택하기"}</Text>
        </TouchableOpacity>
        <View style={{ marginTop: 10 }}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="오늘의 운동/식단 이야기를 남겨보세요"
            multiline
            style={[styles.textInput, { height: 60, textAlignVertical: "top" }]}
            placeholderTextColor="#A6B8B2"
          />
        </View>
        <TouchableOpacity
          style={[styles.submitButton, { marginTop: 10 }]}
          onPress={handleUploadPost}
          activeOpacity={0.85}
          disabled={!selectedImage || isUploading}
        >
          {isUploading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>게시하기</Text>}
        </TouchableOpacity>
      </View>

      {/* 피드 */}
      {isLoadingPosts && <Text style={{ fontSize: 12, color: COLORS.muted, textAlign: "center", paddingVertical: 20 }}>불러오는 중...</Text>}
      {!isLoadingPosts && posts.length === 0 && <EmptyState text="아직 게시글이 없어요. 첫 게시글을 올려보세요!" />}

      {!isLoadingPosts &&
        posts.map((post) => (
          <View key={post.id} style={[styles.card, { padding: 0, overflow: "hidden" }]}>
            <Image source={{ uri: post.image_url }} style={{ width: "100%", aspectRatio: 1 }} resizeMode="cover" />
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.listItemTitle}>{post.display_name}</Text>
                {session?.user.id === post.user_id && (
                  <TouchableOpacity onPress={() => handleDeletePost(post.id)}>
                    <Text style={styles.deleteText}>삭제</Text>
                  </TouchableOpacity>
                )}
              </View>
              {post.caption && <Text style={{ fontSize: 13, color: COLORS.text, marginTop: 6 }}>{post.caption}</Text>}

              <TouchableOpacity onPress={() => toggleComments(post.id)} style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: COLORS.muted, fontWeight: "600" }}>
                  💬 댓글 {commentsByPost[post.id]?.length ?? ""} {expandedPostId === post.id ? "숨기기" : "보기/작성"}
                </Text>
              </TouchableOpacity>

              {expandedPostId === post.id && (
                <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10, gap: 6 }}>
                  {(commentsByPost[post.id] || []).map((c) => (
                    <Text key={c.id} style={{ fontSize: 12 }}>
                      <Text style={{ fontWeight: "700" }}>{c.display_name}</Text> <Text style={{ color: COLORS.text }}>{c.content}</Text>
                    </Text>
                  ))}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    <TextInput
                      value={newCommentByPost[post.id] || ""}
                      onChangeText={(v) => setNewCommentByPost((prev) => ({ ...prev, [post.id]: v }))}
                      placeholder="댓글 달기..."
                      placeholderTextColor="#A6B8B2"
                      style={[styles.textInput, { flex: 1, paddingVertical: 6 }]}
                    />
                    <TouchableOpacity onPress={() => handleAddComment(post.id)} style={{ justifyContent: "center" }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: COLORS.primary }}>등록</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        ))}
    </View>
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
}: {
  goalType: GoalType;
  setGoalType: (g: GoalType) => void;
  weightKgText: string;
  setWeightKgText: (v: string) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  dailyTarget: { calories: number; carbs: number; protein: number; fat: number };
}) {
  const goalOptions: GoalType[] = ["loss", "maintain", "gain"];

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>목표를 선택하세요</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          {goalOptions.map((g) => {
            const active = goalType === g;
            return (
              <TouchableOpacity
                key={g}
                onPress={() => setGoalType(g)}
                style={[
                  styles.goalOption,
                  { backgroundColor: active ? COLORS.primary : COLORS.bg, borderColor: active ? COLORS.primary : COLORS.border },
                ]}
                activeOpacity={0.85}
              >
                <Text style={[styles.goalOptionText, { color: active ? "#FFFFFF" : COLORS.text }]}>{GOAL_LABEL[g]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ marginTop: 16 }}>
          <Input
            label="현재 체중 (kg)"
            value={weightKgText}
            onChangeText={setWeightKgText}
            placeholder="예: 70"
            keyboardType="numeric"
          />
        </View>
        <Text style={styles.goalHint}>
          나이·키·활동량은 반영되지 않은 간이 추정치예요. 실제 권장 섭취량은 전문가와 상담하는 것이 가장 정확합니다.
        </Text>
      </View>

      <View style={styles.card}>
        <Input
          label="랭킹에 표시할 닉네임"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="비워두면 '익명 유저'로 표시돼요"
        />
        <Text style={styles.goalHint}>
          🏆 랭킹 탭에서 다른 사용자와 이번 주 운동 횟수를 비교할 때 이 닉네임이 사용돼요. 식단·운동 상세 기록은 공개되지 않습니다.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>계산된 하루 권장 섭취량</Text>
        <Text style={styles.bigNumber}>
          {dailyTarget.calories.toLocaleString()} <Text style={styles.unitText}>kcal</Text>
        </Text>
        <View style={styles.macroRow}>
          <MacroStat color={COLORS.carb} label="탄수화물" pct={0} grams={dailyTarget.carbs} showPct={false} />
          <MacroStat color={COLORS.protein} label="단백질" pct={0} grams={dailyTarget.protein} showPct={false} />
          <MacroStat color={COLORS.fat} label="지방" pct={0} grams={dailyTarget.fat} showPct={false} />
        </View>
      </View>

      {/* 체급 비교 (레퍼런스 프로 보디빌더) */}
      <View style={{ gap: 8 }}>
        <Text style={styles.sectionTitle}>내 체중과 비교해보는 프로 선수 체급</Text>
        <Text style={styles.goalHint}>
          체중·체지방률은 대부분 정확한 대회 실측치가 공개되어 있지 않아 알려진 범위 내 근사치를 사용했어요. 사진은 초상권 보호를 위해 앱에 직접 넣지 않았으니, 필요하면 각 선수의 공식 프로필/보도 이미지를 직접 찾아 참고해주세요.
        </Text>
        {REFERENCE_ATHLETES.map((athlete) => {
          const leanMass = estimateLeanMass(athlete.weightKg, athlete.bodyFatPct);
          const userWeightKg = Number(weightKgText) || 0;
          const diff = Math.round((userWeightKg - athlete.weightKg) * 10) / 10;

          return (
            <View key={athlete.name} style={styles.athleteCard}>
              <View style={styles.athleteAvatar}>
                <Text style={styles.athleteAvatarText}>{athlete.name.slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.athleteName}>{athlete.name}</Text>
                <Text style={styles.athleteCategory}>{athlete.category}</Text>
                <Text style={styles.athleteStats}>
                  {athlete.heightCm}cm · 대회 체중 {athlete.weightKg}kg · 체지방 약 {athlete.bodyFatPct}%
                </Text>
                <Text style={styles.athleteStats}>추정 제지방량 약 {leanMass}kg (근육·뼈 등 포함)</Text>
                {userWeightKg > 0 && (
                  <Text style={styles.athleteDiff}>
                    내 체중과 {diff > 0 ? `+${diff}` : diff}kg 차이
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---------- 공통 컴포넌트 ----------
function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  secureTextEntry = false,
  autoCapitalize = "sentences",
  style,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "email-address";
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  style?: object;
}) {
  return (
    <View style={[{ marginBottom: 10 }, style]}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        placeholderTextColor="#A6B8B2"
        style={styles.textInput}
      />
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  );
}

// ---------- 스타일 ----------
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  dateText: { fontSize: 12, fontWeight: "500", color: COLORS.muted },
  titleText: { fontSize: 20, fontWeight: "700", color: COLORS.text, marginTop: 2 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 110 },
  tabBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: 8,
    paddingBottom: 18,
  },
  tabButton: { alignItems: "center", paddingHorizontal: 18, paddingVertical: 4, gap: 2 },
  tabIcon: { fontSize: 18 },
  tabLabel: { fontSize: 11 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
  },
  cardLabel: { fontSize: 13, fontWeight: "500", color: COLORS.muted, marginBottom: 6 },
  bigNumber: { fontSize: 30, fontWeight: "700", color: COLORS.text },
  unitText: { fontSize: 14, fontWeight: "500", color: COLORS.muted },
  stackBarTrack: {
    width: "100%",
    height: 12,
    borderRadius: 999,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: COLORS.bg,
    marginTop: 6,
  },
  stackBarSegment: { height: "100%" },
  macroRow: { flexDirection: "row", marginTop: 14 },
  macroLabel: { fontSize: 11, color: COLORS.muted },
  macroPct: { fontSize: 14, fontWeight: "700", color: COLORS.text, marginTop: 3 },
  macroGrams: { fontSize: 11, color: COLORS.muted },
  targetHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  targetSubLabel: { fontSize: 11, color: COLORS.muted },
  targetBarLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  targetBarLabel: { fontSize: 12, fontWeight: "500", color: COLORS.text },
  targetBarValue: { fontSize: 12, color: COLORS.muted },
  targetBarTrack: { width: "100%", height: 8, borderRadius: 999, backgroundColor: COLORS.bg, overflow: "hidden" },
  statRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, padding: 14 },
  statLabel: { fontSize: 11, fontWeight: "500", color: COLORS.muted },
  statNumber: { fontSize: 20, fontWeight: "700", color: COLORS.text, marginTop: 4 },
  formRow: { flexDirection: "row", gap: 10 },
  inputLabel: { fontSize: 11, fontWeight: "500", color: COLORS.muted, marginBottom: 4 },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.text,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  submitButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  photoButton: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoButtonText: { fontSize: 14, fontWeight: "700", color: COLORS.primary },
  dateNavButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  dateNavButtonText: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  listItem: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  listItemTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text },
  listItemSub: { fontSize: 12, color: COLORS.muted, marginTop: 3 },
  deleteText: { fontSize: 12, fontWeight: "500", color: COLORS.fat, paddingHorizontal: 6, paddingVertical: 4 },
  goalOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  goalOptionText: { fontSize: 13, fontWeight: "600" },
  goalHint: { fontSize: 11, color: COLORS.muted, marginTop: 10, lineHeight: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: COLORS.text, marginTop: 4 },
  athleteCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  athleteAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  athleteAvatarText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  athleteName: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  athleteCategory: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  athleteStats: { fontSize: 12, color: COLORS.text, marginTop: 4 },
  athleteDiff: { fontSize: 12, fontWeight: "600", color: COLORS.primary, marginTop: 4 },
  emptyState: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.border,
    padding: 24,
    alignItems: "center",
  },
  emptyStateText: { fontSize: 13, color: COLORS.muted, textAlign: "center" },
});
