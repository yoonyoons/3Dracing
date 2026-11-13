// 닉네임 검사. 개인정보를 받지 않으므로 "별명"만 쓰도록 안내하고, 나쁜 말은 막습니다.

const BANNED = [
  // 한국어 욕설·비하 표현 (자주 쓰이는 변형 포함)
  '시발', '씨발', '씨빨', '시빨', '씨바', '시바', 'ㅅㅂ', 'ㅆㅂ', '쓰발', '병신', 'ㅂㅅ', '븅신', '빙신',
  '지랄', 'ㅈㄹ', '좆', '졷', 'ㅈ같', '존나', '졸라', 'ㅈㄴ', '개새', '개색', '새끼', '색기', '쌔끼', '미친놈', '미친년',
  '꺼져', '닥쳐', '엿먹', '느금', '니애미', '니엄마', '엄창', '애미', '창녀', '걸레', '보지', '자지', '섹스', '야동',
  '죽어', '뒤져', '자살', '살인', '찐따', '장애인', '한남', '김치녀', '틀딱', '급식충', '맘충', '일베', '메갈',
  '똥꼬', '변태', '성기', '강간', '애자',
  // 영어
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'porn', 'sex', 'nigg', 'fag', 'cunt', 'bastard', 'kill',
];

export const NICK_MAX = 8;

export function normalizeNick(raw: string): string {
  return (raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function squash(s: string): string {
  // 금칙어 사이에 숫자·기호·공백을 끼워 넣는 꼼수를 막습니다.
  return s.toLowerCase().replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
}

export function hasBannedWord(text: string): boolean {
  const s = squash(text);
  return BANNED.some((w) => s.includes(w));
}

/** 문제가 없으면 null, 있으면 학생에게 보여 줄 안내 문구 */
export function checkNickname(raw: string): string | null {
  const name = normalizeNick(raw);
  if (name.length === 0) return '별명을 적어 주세요.';
  if ([...name].length > NICK_MAX) return `별명은 ${NICK_MAX}글자까지예요.`;
  if (!/^[a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ _-]+$/.test(name)) return '한글, 영어, 숫자만 쓸 수 있어요.';
  if (hasBannedWord(name)) return '다른 별명을 써 주세요.';
  return null;
}

const A = ['빠른', '용감한', '반짝', '씽씽', '튼튼', '웃는', '날쌘', '멋진', '귀여운', '졸린', '신난', '파란', '노란', '초록'];
const B = ['호랑이', '토끼', '거북이', '번개', '로켓', '구름', '고래', '펭귄', '다람쥐', '수달', '여우', '판다', '돌고래', '별똥별'];

/** 실명 대신 쓸 수 있는 별명 추천 */
export function randomNickname(rnd: () => number = Math.random): string {
  for (let i = 0; i < 20; i++) {
    const n = A[Math.floor(rnd() * A.length)] + B[Math.floor(rnd() * B.length)];
    if ([...n].length <= NICK_MAX) return n;
  }
  return '번개';
}
