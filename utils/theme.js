export const CARD_GRADIENTS = {
  1: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  2: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  3: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  4: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  5: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
};

export const BOOK_GRADIENTS = {
  primary: 'linear-gradient(135deg, #56ab2f 0%, #a8e063 100%)',
  middle: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
  high: 'linear-gradient(135deg, #834d9b 0%, #d04ed6 100%)',
  cet4: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)',
  cet6: 'linear-gradient(135deg, #eb3349 0%, #f45c43 100%)',
};

export function getCardGradient(level) {
  return CARD_GRADIENTS[level] || CARD_GRADIENTS[1];
}

export function getBookGradient(bookCode) {
  return BOOK_GRADIENTS[bookCode] || 'linear-gradient(135deg, #4a90e2 0%, #67b8ff 100%)';
}
