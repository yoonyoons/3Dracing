// 닉네임 검사. 개인정보를 받지 않으므로 "별명"만 쓰도록 안내하고, 나쁜 말은 막습니다.

const BANNED = [
  // 한국어 욕설·비하 표현 (자주 쓰이는 변형 포함)
  '시발', '씨발', '씨빨', '시빨', '씨바', '씨팔', '시팔', '씹', '쓰발', '쉬발', '슈발', '십새', '십쌔', '개시키',
  'ㅅㅂ', 'ㅆㅂ', 'ㅅㅃ', 'ㅆㅃ', 'ㅂㅅ', 'ㅄ', 'ㅈㄹ', 'ㅈㄴ', 'ㅁㅊ', 'ㄱㅅㄲ', 'ㅅㄲ', 'ㅈ같', 'ㅗ',
  '병신', '븅신', '빙신', '병쉰', '지랄', '좆', '졷', '존나', '졸라', '조낸', '개새', '개색', '개세', '새끼', '색기', '쌔끼', '섀끼',
  '미친놈', '미친년', '미친새', '꺼져', '닥쳐', '닥치', '엿먹', '느금', '니애미', '니엄마', '느개비', '엄창', '애미', '애비',
  '창녀', '걸레', '보지', '자지', '섹스', '야동', '야사', '죽어', '죽을래', '뒤져', '디져', '자살', '살인',
  '찐따', '장애인', '한남', '김치녀', '틀딱', '급식충', '맘충', '일베', '메갈', '똥꼬', '변태', '성기', '강간', '애자',
  // 한글 자판으로 영어 칸에 친 욕 (예: 시발 → tlqkf)
  'tlqkf', 'tlqk', 'qudtls', 'wlfkf', 'whssk', 'rotoRl', 'rotorl', 'tptmr',
  // 영어 (짧은 단어는 정상 단어에 섞여 있어 아래 ENGLISH_WORDS 로 따로 봅니다)
  'fuck', 'fuk', 'fck', 'shit', 'sht', 'bitch', 'btch', 'asshole', 'pussy', 'porn', 'nigg', 'cunt', 'bastard',
  'motherf', 'nazi', 'hitler', 'retard', 'whore', 'slut', 'stfu', 'wtf',
].map((w) => w.toLowerCase());

export const NICK_MAX = 8;

export function normalizeNick(raw: string): string {
  return (raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** 따로 떨어져 있을 때만 막는 짧은 영어 단어 (skill, essex 같은 정상 단어를 막지 않도록) */
const ENGLISH_WORDS = ['sex', 'dick', 'fag', 'kill', 'die', 'ass', 'gay', 'xx'];

/** 숫자로 쓰는 욕 (18 = 시발). "선수18" 같은 번호는 막지 않고, "18" 단독이나 "18놈" 같은 꼴만 막습니다. */
const NUMBER_SLANG = /^18$|(^|[^0-9])18(놈|년|새|색|롬|럼|련|아|ㅅ|ㄴ)|ㅅ1ㅂ|ㅆ1ㅂ|ㅅ[1l]발/;

// 숫자·기호를 비슷한 글자로 바꿉니다 (f4ck → fack, sh1t → shit).
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function squash(s: string): string {
  // 금칙어 사이에 숫자·기호·공백을 끼워 넣는 꼼수를 막습니다.
  return s.toLowerCase().replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
}

function deLeet(s: string): string {
  return s.toLowerCase().replace(/[0-9@$!]/g, (c) => LEET[c] ?? c).replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
}

export function hasBannedWord(text: string): boolean {
  const raw = (text ?? '').normalize('NFC');
  if (NUMBER_SLANG.test(raw.replace(/\s+/g, ''))) return true;
  for (const s of [squash(raw), deLeet(raw)]) {
    if (BANNED.some((w) => s.includes(w))) return true;
  }
  // 짧은 영어 단어는 단어 하나로 떨어져 있을 때만 (예: "sex", "ass 7" → 막음 / "skill", "glass" → 통과)
  const words = raw.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => ENGLISH_WORDS.includes(w));
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
