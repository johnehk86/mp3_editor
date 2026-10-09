# 안드로이드 앱 + AdMob 출시 가이드

웹 앱을 [Capacitor](https://capacitorjs.com)로 감싼 안드로이드 앱입니다. 광고는 `@capacitor-community/admob`.

- 하단 배너: 앱 실행 중 항상 표시
- 전면 광고: 파일 저장 직후, 최소 3분 간격 (`src/native.js`의 `INTERSTITIAL_MIN_GAP_MS`)
- EU 등 동의가 필요한 지역은 실행 시 Google 동의 화면(UMP) 표시
- 저장 위치: 기기의 `문서/AudioEditor` 폴더

## 1. 개발 환경 (최초 1회)

1. [Android Studio](https://developer.android.com/studio) 설치 (JDK·Android SDK가 함께 설치됨)
2. 휴대폰: 설정 > 휴대전화 정보 > 빌드번호 7번 탭 → 개발자 옵션 > USB 디버깅 켜기

## 2. 테스트 실행

```bash
npm run android:sync   # 웹 빌드 → 안드로이드 프로젝트로 복사
npm run android:open   # Android Studio 열기 → ▶ 실행
```

지금은 **Google 테스트 광고 ID**가 들어 있어서 "Test Ad" 표시가 붙은 광고가 나옵니다.
개발 중에 실제 광고를 띄우고 직접 누르면 AdMob 계정이 정지될 수 있으니 꼭 테스트 ID로 개발하세요.

## 3. AdMob 등록 (실제 광고 ID 받기)

1. AdMob > 앱 > 앱 추가 > Android. (Play 스토어 출시 전이면 "아니요"로 등록, 출시 후 스토어와 연결)
2. **앱 ID** (`ca-app-pub-XXXX~YYYY`) → `android/app/src/main/res/values/strings.xml` 의 `admob_app_id`
3. 광고 단위 2개 만들기
   - 배너 → `VITE_ADMOB_BANNER_ID`
   - 전면 광고 → `VITE_ADMOB_INTERSTITIAL_ID`
4. `.env.example`을 `.env.production`으로 복사하고 두 광고 단위 ID 입력
5. 내 휴대폰은 AdMob > 설정 > 테스트 기기에 등록 (실제 ID로도 테스트 광고만 나오게)
6. 개인정보 보호 및 메시지 > GDPR 메시지 만들기 (EU 동의 화면)

## 4. 출시용 빌드 (AAB)

Android Studio > Build > Generate Signed App Bundle / APK > Android App Bundle
→ 새 키 저장소(.jks) 만들기. **키 파일과 비밀번호를 잃어버리면 앱을 업데이트할 수 없으니 안전하게 백업**하세요 (git에 올리지 말 것).

업데이트할 때마다 `android/app/build.gradle`의 `versionCode`를 1씩 올립니다.

## 5. Google Play 출시

1. [Play Console](https://play.google.com/console) 가입 (등록비 US$25, 본인 인증)
2. 앱 만들기 → 스토어 등록정보(아이콘 512px, 스크린샷, 설명)
3. 앱 콘텐츠
   - 개인정보처리방침 URL: `https://<배포 주소>/privacy.html`
   - 광고 포함: **예**
   - 데이터 보안: AdMob이 수집하는 기기 ID·대략적 위치·앱 상호작용 등을 신고
     ([AdMob 데이터 공개 안내](https://developers.google.com/admob/android/privacy/play-data-disclosure))
4. 2023년 11월 이후 만든 **개인 계정은 비공개 테스트(테스터 12명 이상, 14일)** 를 거쳐야 프로덕션 출시 가능

## 6. 출시 후

- `public/app-ads.txt` 파일을 만들고 아래 한 줄을 넣어 배포 (AdMob > 앱 > app-ads.txt 에서 확인)
  ```
  google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
  ```
- Play Console 스토어 등록정보의 "웹사이트"에 배포 주소(도메인)를 넣어야 AdMob이 app-ads.txt를 찾습니다.
