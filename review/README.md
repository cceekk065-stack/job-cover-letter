# AI 자소서 첨삭 웹앱

교육생이 **이미 쓴 자기소개서**를 붙여넣으면 AI(Gemini)가 문항별로 첨삭해 주는 웹앱입니다.
같은 저장소의 자소서 컨설팅 앱(저장소 맨 위 폴더)과는 따로 동작하며, 링크도 따로 생깁니다.

## 교육생이 받는 결과 (문항마다)
- **점수(0~100)와 총평**
- **항목별 평가 (상/중/하)**: 문항 적합성 · 구체성(STAR) · 직무 연관성 · 논리·구성 · 문장·표현
- **잘한 점**
- **고칠 점**: 원문 구절을 인용하고, 문제와 고치는 방법을 함께 보여 줍니다
- **수정안**: 글자 수 제한에 맞춰 다시 쓴 글. 원문에 없는 경험이나 수치는 지어내지 않고 `[참여 인원 수]`처럼 빈칸으로 남깁니다
- **면접 예상 질문 3개**

그 밖의 기능
- 글자 수 세기(공백 포함/제외)와 초과 경고. 수정안의 글자 수는 AI가 센 값이 아니라 앱이 직접 셉니다
- 문항 최대 6개, 문항별 첨삭 또는 전체 첨삭
- `내 답변에 넣기` → 빈칸을 채운 뒤 `다시 첨삭`으로 반복해서 고칠 수 있습니다
- 결과 복사, 텍스트(.txt)·워드(.doc) 다운로드, 브라우저 자동 저장

## 배포 방법 (Vercel 무료)
1. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 Gemini API 키를 발급합니다. 기존 컨설팅 앱의 키를 그대로 써도 되지만, 두 앱이 무료 한도를 나눠 쓰게 됩니다.
2. [vercel.com](https://vercel.com)에서 `Add New → Project`를 누르고 이 저장소(`job-cover-letter`)를 다시 선택합니다. 같은 저장소로 프로젝트를 하나 더 만드는 것입니다.
3. **Root Directory**를 `review`로 지정합니다. 가장 중요한 단계입니다. Framework Preset은 `Other`로 둡니다.
4. Environment Variables에 `GEMINI_API_KEY`를 등록합니다. `GEMINI_MODEL`은 선택 사항입니다.
5. `Deploy`를 누르면 `https://프로젝트명.vercel.app` 주소가 생깁니다. 프로젝트 이름을 `cover-letter-review` 같은 이름으로 정하면 주소도 그렇게 만들어집니다.

참고: [Vercel 모노레포 문서](https://vercel.com/docs/monorepos)

## 바꿀 수 있는 곳
| 바꾸고 싶은 것 | 파일 |
|---|---|
| 비밀번호 (기본 `2026`, 컨설팅 앱과 같음) | `lib/auth.js`의 `APP_PASSWORD` |
| 첨삭 기준, 말투, 점수 기준 | `lib/prompt.js` (서버에만 있어 교육생에게 보이지 않음) |
| 블로그 링크, 최대 문항 수 | `public/app.js` 맨 위 설정 |

## 무료 사용량
한 문항을 첨삭할 때 Gemini를 1번 호출합니다. 전체 첨삭을 눌러도 문항을 하나씩 차례로 보내서 분당 한도를 아낍니다.
한 모델의 한도가 차면(429) 다른 Flash 모델로 자동으로 바꿉니다.
무료 한도는 [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) 문서와 AI Studio 사용량 화면에서 확인하세요.

## 로컬에서 실행해 보기
```bash
cd review
cp .env.example .env   # 키 입력
npm run dev            # http://localhost:3000
```
