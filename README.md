# 맞춤형 자소서 컨설팅 웹앱

Gemini 챗봇으로 운영하던 "자소서 컨설팅 5단계" 실습을 웹앱으로 옮긴 프로젝트입니다.
수강생은 링크로 접속해 **오늘의 비밀번호 4자리**를 입력한 뒤 4개 문항을 차례로 완성합니다.

## Gemini 챗봇보다 안정적인 이유

| 기존 챗봇에서 자주 생기는 문제 | 웹앱에서 바꾼 점 |
|---|---|
| 비밀번호 없이 진행되거나 비밀번호가 노출됨 | 서버가 비밀번호를 확인합니다. 비밀번호는 수강생 화면이나 코드에 나타나지 않습니다 (`api/login.js`, `api/chat.js`) |
| 첫 인사말이 매번 달라짐 | 첫 인사와 비밀번호 화면은 고정 문구로 표시됩니다 |
| 여러 단계를 한꺼번에 출력함 | 프롬프트에 "한 번에 한 단계" 규칙을 넣고, 화면 위쪽에 현재 단계를 표시합니다 |
| 몇 번째 문항인지 잊어버림 | 문항이 끝날 때마다 앱이 개수를 세서 `문항 N/4`로 보여 줍니다 |
| 마지막에 구글 폼 링크가 빠지거나 틀림 | 4문항을 마치거나 '컨설팅 종료'를 누르면 앱이 링크를 직접 보여 줍니다 |
| 새로고침하면 대화가 사라짐 | 대화가 브라우저에 자동 저장됩니다 |

## 결과 저장 3가지
1. **복사**: 답변마다 있는 `📋 복사` 버튼과 `요약본 전체 복사` 버튼으로 클립보드에 복사합니다. 구글 폼에 바로 붙여넣으면 됩니다.
2. **다운로드**: `텍스트 다운로드`(.txt)와 `워드 다운로드`(.doc)가 있습니다. 파일에는 요약본과 전체 대화가 함께 들어갑니다.
3. **브라우저 임시 저장**: 대화가 자동 저장되어 새로고침하거나 창을 닫았다 열어도 남아 있습니다. 공용 PC에서는 실습이 끝난 뒤 `처음부터 다시`를 눌러 지워 주세요.

## 배포 방법 (Vercel 무료)

1. **Gemini API 키 발급**: [Google AI Studio](https://aistudio.google.com/app/apikey)에서 `Create API key`를 누릅니다.
2. **Vercel 가입**: [vercel.com](https://vercel.com)에 GitHub 계정으로 로그인합니다.
3. **프로젝트 가져오기**: `Add New → Project`에서 이 저장소(`job-cover-letter`)를 선택합니다. Framework Preset은 `Other`로 둡니다.
4. **환경변수 등록** (Settings → Environment Variables):

   | 이름 | 값 | 설명 |
   |---|---|---|
   | `GEMINI_API_KEY` | 발급받은 키 | 필수 |
   | `APP_PASSWORD` | 예: `2026` | 오늘의 비밀번호 (4자리) |
   | `GEMINI_MODEL` | 예: `gemini-3.5-flash` | 선택. 비워 두면 `gemini-3.5-flash`를 씁니다 |

5. `Deploy`를 누르면 `https://프로젝트명.vercel.app` 주소가 생깁니다. 이 링크를 수강생에게 나눠 주세요.

### 비밀번호 바꾸기 (수업마다)
Vercel → Settings → Environment Variables에서 `APP_PASSWORD` 값을 고친 뒤, **Deployments → 최근 배포 ⋯ → Redeploy**를 눌러야 반영됩니다.

### 모델 오류가 날 때
"모델을 찾을 수 없습니다"라는 메시지가 나오면 `GEMINI_MODEL`에 현재 제공되는 모델 ID를 넣으세요.
최신 모델 목록은 [Gemini API 모델 문서](https://ai.google.dev/gemini-api/docs/models)에서 확인할 수 있습니다.

## 프롬프트 수정
컨설팅 내용(단계, 가이드 질문, 요약 포맷)은 `lib/prompt.js`에 있습니다. 이 파일은 서버에만 있어서 수강생에게 보이지 않습니다.
구글 폼과 블로그 링크는 `public/index.html` 안의 `finalBox` 부분에 있습니다.

## 로컬에서 실행해 보기
```bash
cp .env.example .env   # 키와 비밀번호 입력
npm run dev            # http://localhost:3000
```
(Node.js 18 이상이 필요하고, 따로 설치할 패키지는 없습니다)

## 파일 구조
```
public/        수강생이 보는 화면 (index.html, style.css, app.js)
api/login.js   비밀번호 확인
api/chat.js    Gemini 호출 (API 키는 서버에만 보관)
lib/prompt.js  컨설팅 시스템 프롬프트
```
