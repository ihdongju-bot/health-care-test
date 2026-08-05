import { Platform } from "react-native";
import AppleHealthKit, { HealthValue, HealthKitPermissions } from "react-native-health";

// ---------- 웨어러블(Apple HealthKit) 연동 ----------
// ⚠️ 중요한 제약사항:
// - HealthKit은 iOS 전용입니다. Android에서는 이 모듈이 동작하지 않습니다
//   (Android는 Google Health Connect가 필요하며, 별도 패키지
//   'react-native-health-connect' 연동이 필요합니다 — 아직 미구현).
// - HealthKit은 네이티브 모듈이라 Expo Go 앱에서는 절대 동작하지 않습니다.
//   반드시 EAS Build로 커스텀 개발 빌드(dev client)를 만들어야 테스트할 수 있습니다.
//   (npx expo install expo-dev-client 후 npx eas build --profile development --platform ios)
// - iOS 시뮬레이터는 실제 건강 데이터가 없어 걸음 수가 항상 0으로 나올 수 있습니다.
//   실기기에서 테스트하는 것을 권장합니다.
// - app.json에 아래 플러그인 설정이 필요합니다:
//   "plugins": [["react-native-health", { "isClinicalDataEnabled": false, "healthSharePermission": "걸음 수와 활동 칼로리를 읽기 위해 건강 데이터 접근 권한이 필요해요." }]]

const permissions: HealthKitPermissions = {
  permissions: {
    read: [AppleHealthKit.Constants.Permissions.Steps, AppleHealthKit.Constants.Permissions.ActiveEnergyBurned],
    write: [],
  },
};

export function isHealthKitAvailable(): boolean {
  return Platform.OS === "ios";
}

export function requestHealthKitPermissions(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isHealthKitAvailable()) {
      resolve(false);
      return;
    }
    try {
      AppleHealthKit.initHealthKit(permissions, (error: string) => {
        resolve(!error);
      });
    } catch {
      // 네이티브 모듈이 링크되어 있지 않은 환경(예: Expo Go)에서는 여기로 빠집니다.
      resolve(false);
    }
  });
}

export function fetchTodaySteps(): Promise<number> {
  return new Promise((resolve) => {
    if (!isHealthKitAvailable()) {
      resolve(0);
      return;
    }
    try {
      const options = { date: new Date().toISOString() };
      AppleHealthKit.getStepCount(options, (err: string, results: HealthValue) => {
        if (err) {
          resolve(0);
          return;
        }
        resolve(Math.round(results?.value ?? 0));
      });
    } catch {
      resolve(0);
    }
  });
}

export function fetchTodayActiveEnergy(): Promise<number> {
  return new Promise((resolve) => {
    if (!isHealthKitAvailable()) {
      resolve(0);
      return;
    }
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const options = { startDate: startOfDay.toISOString(), endDate: new Date().toISOString() };
      AppleHealthKit.getActiveEnergyBurned(options, (err: string, results: HealthValue[]) => {
        if (err || !results) {
          resolve(0);
          return;
        }
        const total = results.reduce((sum, r) => sum + (r.value || 0), 0);
        resolve(Math.round(total));
      });
    } catch {
      resolve(0);
    }
  });
}
