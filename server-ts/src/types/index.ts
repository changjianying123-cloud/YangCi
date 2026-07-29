import { RowDataPacket } from 'mysql2/promise';

export type CardStatus = 'incubating' | 'ready' | 'hungry' | 'downgraded' | 'normal';
export type MoodType = 'happy' | 'sad' | 'none';

export interface UserRow extends RowDataPacket {
  id: number;
  openid: string;
  nickname: string | null;
  avatar_url: string | null;
  created_at: Date;
}

export interface BookRow extends RowDataPacket {
  id: number;
  book_code: string;
  book_name: string;
  icon: string;
  color: string;
  total_words: number;
}

export interface WordRow extends RowDataPacket {
  id: number;
  book_id: number;
  word: string;
  phonetic: string | null;
  meaning: string;
  audio_url: string | null;
  example_sentence: string | null;
  book_code?: string;
}

export interface UserCardRow extends RowDataPacket {
  id: number;
  user_id: number;
  word_id: number;
  level: number;
  feed_deadline: number;
  feed_window_end: number;
  last_feed_at: number | null;
  hunger_start_at: number | null;
  downgrade_count: number;
  is_egg: number;
  feed_spell_count: number;
  created_at: Date;
  word?: string;
  meaning?: string;
  phonetic?: string;
  audio_url?: string;
  book_code?: string;
  book_name?: string;
  // 新增字段（迁移）
  remedial_feed_at?: number | null;
  had_wrong_attempt?: number;
  abandoned?: number;
  abandoned_at?: number | null;
}

export interface CardDTO {
  id: number;
  wordId: number;
  word: string;
  meaning: string;
  phonetic: string | null;
  audioUrl: string | null;
  bookCode: string;
  bookName: string;
  level: number;
  feedDeadline: number;
  feedWindowEnd: number;
  lastFeedAt: number | null;
  downgradeCount: number;
  isEgg: boolean;
  status: CardStatus;
  canFeed: boolean;
  feedSpellCount: number;
  feedSpellRequired: number;
  nextFeedIn: string;
  mood: MoodType;
  hasRemedial: boolean;
  remedialFeedAt: number | null;
  isLv1: boolean;
  lv1FeedProgress: number;
  hasRemedialWindow: boolean;
}

export interface JwtPayload {
  userId: number;
  openid: string;
}

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}
