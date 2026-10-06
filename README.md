# 오디오 편집기

브라우저에서 동작하는 MP3/오디오 편집기입니다. 파일은 서버로 올라가지 않고 내 컴퓨터 안에서만 처리됩니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 에 정적 파일 생성
```

## 앱으로 설치

배포된 주소를 Chrome/Edge로 열고 왼쪽 메뉴의 **앱 설치** 버튼(또는 주소창의 설치 아이콘)을 누르면
독립된 창으로 실행되는 앱이 됩니다. 한 번 열어 두면 오프라인에서도 동작하고,
설치 후에는 탐색기에서 오디오 파일을 이 앱으로 열 수 있습니다.

## Cloudflare Pages 배포

- Build command: `npm run build`
- Build output directory: `dist`

## 기능

- **자르기**: 핸들로 구간 선택 → 잘라내기(구간만 남김) / 제거(구간 삭제), 실행 취소·다시 실행
- **페이드 인/아웃**: 길이 0.5~10초
- **저장**: 선택 구간을 MP3(128/192/320kbps) 또는 WAV로 저장
- **보컬 제거**: 센터 채널 상쇄 (저음 유지 옵션)
- **볼륨 증폭**: 선택 구간 증폭/감소, 작은 음성 자동 키우기(음성 크게), 최대치 맞춤, 클리핑 방지 리미터
- **템포 찾기**: 자동 BPM 분석 + 탭 템포
- 휠로 확대/축소, Shift+휠로 이동, 단축키는 앱의 "도움말" 참고

## 구조

| 파일 | 역할 |
| --- | --- |
| `src/audio/timeline.js` | 비파괴 편집 모델. 원본 버퍼는 그대로 두고 구간 목록만 바꿔서 긴 파일도 실행 취소가 가볍다 |
| `src/audio/peaks.js` | 줌 레벨별 파형 min/max 피라미드 |
| `src/audio/player.js` | Web Audio 재생 (페이드는 GainNode 자동화) |
| `src/audio/exporter.js`, `encoder.worker.js` | 청크 단위 인코딩 (Web Worker, lamejs) |
| `src/audio/tools.js` | 보컬 제거, BPM 분석 |
| `src/ui/waveform.js` | 파형 캔버스, 핸들, 확대/스크롤 |
| `src/main.js` | 앱 상태와 이벤트 연결 |
