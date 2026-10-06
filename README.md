# 오디오 편집기

브라우저에서 동작하는 MP3/오디오 편집기입니다. 파일은 서버로 올라가지 않고 내 컴퓨터 안에서만 처리됩니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 에 정적 파일 생성
```

## 기능

- **자르기**: 핸들로 구간 선택 → 잘라내기(구간만 남김) / 제거(구간 삭제), 실행 취소·다시 실행
- **페이드 인/아웃**: 길이 0.5~10초
- **저장**: 선택 구간을 MP3(128/192/320kbps) 또는 WAV로 저장
- **보컬 제거**: 센터 채널 상쇄 (저음 유지 옵션)
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
