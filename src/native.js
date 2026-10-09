// 안드로이드 앱(Capacitor)에서만 쓰는 기능: AdMob 광고, 기기 저장소에 파일 저장.
// 웹/PWA에서는 isNative가 false라서 아무것도 하지 않고, 플러그인 코드도 불러오지 않는다.
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

// 광고 단위 ID. 비워 두면 Google 테스트 광고가 나온다.
// 출시할 때는 .env.production 에 AdMob에서 발급받은 실제 ID를 넣는다 (.env.example 참고).
const TEST_IDS = {
  banner: 'ca-app-pub-3940256099942544/9214589741',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
};
const IDS = {
  banner: import.meta.env.VITE_ADMOB_BANNER_ID || TEST_IDS.banner,
  interstitial: import.meta.env.VITE_ADMOB_INTERSTITIAL_ID || TEST_IDS.interstitial,
};
const IS_TEST = !import.meta.env.VITE_ADMOB_BANNER_ID;

// 전면 광고는 저장 직후에만, 최소 이 간격을 두고 보여 준다 (너무 잦으면 사용자가 떠나고 정책 위반 위험)
const INTERSTITIAL_MIN_GAP_MS = 3 * 60 * 1000;

let admob = null;
let interstitialReady = false;
let lastInterstitialAt = 0;

/** 광고 초기화: 동의(EU 등) 확인 → 하단 배너 → 전면 광고 미리 불러오기 */
export async function initAds({ onBannerHeight }) {
  if (!isNative) return;
  try {
    admob = await import('@capacitor-community/admob');
    const { AdMob, AdmobConsentStatus, BannerAdPluginEvents, InterstitialAdPluginEvents } = admob;

    await AdMob.initialize({ initializeForTesting: IS_TEST });

    // GDPR 등 동의가 필요한 지역이면 동의 화면을 띄운다 (Google UMP)
    let consent = await AdMob.requestConsentInfo();
    if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
      consent = await AdMob.showConsentForm();
    }
    if (consent.canRequestAds === false) return;

    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => onBannerHeight(size.height));
    AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => onBannerHeight(0));
    AdMob.addListener(InterstitialAdPluginEvents.Loaded, () => (interstitialReady = true));
    AdMob.addListener(InterstitialAdPluginEvents.Dismissed, prepareInterstitial);
    AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, prepareInterstitial);

    await AdMob.showBanner({
      adId: IDS.banner,
      adSize: admob.BannerAdSize.ADAPTIVE_BANNER,
      position: admob.BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: IS_TEST,
    });
    prepareInterstitial();
  } catch (err) {
    console.warn('광고 초기화 실패', err);
  }
}

async function prepareInterstitial() {
  interstitialReady = false;
  try {
    await admob.AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: IS_TEST });
  } catch {
    // 불러오기 실패 — 다음 저장 때 다시 시도
    setTimeout(prepareInterstitial, 60 * 1000);
  }
}

/** 저장이 끝난 뒤 호출. 준비돼 있고 간격이 충분하면 전면 광고를 보여 준다. */
export async function maybeShowInterstitial() {
  if (!admob || !interstitialReady) return;
  if (Date.now() - lastInterstitialAt < INTERSTITIAL_MIN_GAP_MS) return;
  lastInterstitialAt = Date.now();
  interstitialReady = false;
  try {
    await admob.AdMob.showInterstitial();
  } catch {
    prepareInterstitial();
  }
}

// ---------- 파일 저장 ----------
const SAVE_DIR = 'AudioEditor';
const CHUNK = 3 * 1024 * 1024; // 3의 배수라 조각마다 base64가 그대로 이어 붙는다

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function uniquePath(Filesystem, Directory, name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 0; ; i++) {
    const path = `${SAVE_DIR}/${i ? `${base} (${i})` : base}${ext}`;
    try {
      await Filesystem.stat({ path, directory: Directory.Documents });
    } catch {
      return path;
    }
  }
}

/** 기기의 문서/AudioEditor 폴더에 저장하고, 사용자에게 보여 줄 위치를 돌려준다. */
export async function saveToDevice(blob, name, onProgress) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const path = await uniquePath(Filesystem, Directory, name);
  if (blob.size === 0) {
    await Filesystem.writeFile({ path, data: '', directory: Directory.Documents, recursive: true });
  }
  for (let off = 0; off < blob.size; off += CHUNK) {
    const data = await toBase64(blob.slice(off, off + CHUNK));
    if (off === 0) await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Documents });
    onProgress?.(Math.min(1, (off + CHUNK) / blob.size));
  }
  return `문서/${path}`;
}
