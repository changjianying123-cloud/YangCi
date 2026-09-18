import { RowDataPacket } from 'mysql2/promise';

export type CardStatus = 'incubating' | 'ready' | 'hungry' | 'normal';
export type MoodType = 'happy' | 'sad' | 'none';

export interface UserRow extends RowDataPacket {
  id: number;
  openid: string;
  username: string | null;
  password_hash: string | null;
  nickname: string | null;
  avatar_url: string | null;
  coins: number;
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
  pos: string | null; // noun / adjective / verb / adverb，可逗号分隔多词性
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
  // 心情系统（玩耍）
  mood_score?: number;
  play_count?: number;
  play_correct_count?: number;
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
  /** 是否可以玩耍（饥饿/降级/蛋 都不行） */
  canPlay: boolean;
  feedSpellCount: number;
  feedSpellRequired: number;
  /** 还需拼写正确多少次（倒着数 3→2→1） */
  feedSpellRemaining: number;
  nextFeedIn: string;
  mood: MoodType;
  /** 心情分值（负数=悲伤，0=平静，正数=开心） */
  moodScore: number;
  /** 玩耍累计次数 / 答对次数 */
  playCount: number;
  playCorrectCount: number;
  hasRemedial: boolean;
  remedialFeedAt: number | null;
  isLv1: boolean;
  lv1FeedProgress: number;
  hasRemedialWindow: boolean;
  // 金币系统
  coins: number;
  isHungry: boolean;
  canRecoverFromHunger: boolean;
  feedCoinReward: number;
}

export interface JwtPayload {
  userId: number;
  openid: string;
}

// ===== 单词对战 =====
// 词性(可多)在 WordRow.pos 中，例如 'noun,verb'
export type BattleRole = 'noun' | 'adjective' | 'verb' | 'adverb';

export type BattlePos = 'front' | 'back';

export interface BattleUnit {
  cardId: number;      // user_cards.id
  wordId: number;
  word: string;
  meaning: string;
  // 若多词性，本局用哪个词性技能（组队时系统选定）
  role: BattleRole;
  level: number;
  // 动态战斗属性
  hp: number;
  maxHp: number;
  atkBuff: number;     // 副词叠加的攻击加成层数
  shield: number;      // 当前护盾层数（每层=能挡一次攻击；0=一击必杀）
  shieldBuff: number;  // 形容词叠加的「护盾强度」：名词放盾时每层多放 1 层盾（类比副词的 atkBuff）
  // 阵亡/复活
  dead: boolean;
  usedSkill: boolean;  // 发动过技能（默认 true；未用过技能就阵亡的可复活）
  revived: boolean;    // 本局是否已复活过一次
  shieldBroken?: boolean; // 刚破盾标记：破盾后 1 回合内不能续盾（防止胶着）
  // 其他：多词性词的本局选定 role 存于 role
}

export interface BattleSide {
  userId: number;      // AI 用 -1；真人 PvP 为真实 userId
  nickname: string;
  units: BattleUnit[];           // 全部单位(含阵亡)按出征顺序；阵亡只置 dead=true 不移除，便于阵亡列显示
  queue: number[];               // 当前“站立队列”：未阵亡单位的 cardId 顺序——首位=最前，前4=前排，其余=后排；行动单位移到队尾、阵亡移除、复活加回队尾
  deployed?: boolean;            // 真人 PvP：该方是否已布阵
}

export interface BattleSnapshot {
  turn: number;
  currentSide: number;    // 0=玩家, 1=敌方
  activeUntil: number;
  // 本回合开始时刻 + 回合时长（客户端据此算本地倒计时，避免设备时钟偏差）
  turnStartedAt?: number;
  turnSeconds?: number;
  over: boolean;
  winner: number | null;
  reason: string;
  deployed?: boolean;    // 是否已完成布阵（开战）。false/未设=仍在布阵阶段
  playerFirst?: boolean; // 开战投币：本局玩家是否先手
  aiOpened?: boolean;    // 本局 AI 先手时是否已走过开场回合
  mode?: 'rookie' | 'gold'; // 对战模式：新手场 / 金币场（真人 PvP）
  bet?: number;             // 金币场押注金额（每方押注，赢家拿走 2×bet）
  roomId?: number;          // 金币场「房间」ID（房间制时结算交给 battleRoomService）
  /**
   * 拼写模式（决定弹窗给什么提示、要拼什么）：
   *  - 'en-spell'（默认）：给出英文单词卡牌，拼写英文（同「喂养」）
   *  - 'zh-spell'：给出英文单词卡牌，拼写任一中文意思即可（同「玩耍」的英译汉）
   *  - 'zh'（兼容旧值，等同 'en-spell'）
   */
  spellMode?: 'en-spell' | 'zh-spell';
  player: BattleSide;
  enemy: BattleSide;
  log: string[];
}

export interface BattleRow extends RowDataPacket {
  id: number;
  player_user_id: number;
  enemy_user_id: number | null; // null=AI
  mode: 'ai' | 'pvp';
  status: 'active' | 'finished';
  state: string;              // JSON BattleSnapshot
  turn_now: number;
  turn_deadline: number;
  winner: number | null;
  rewards: string | null;     // JSON
  created_at: Date;
  finished_at: Date | null;
}

export interface BattleQueueRow extends RowDataPacket {
  id: number;
  user_id: number;
  nickname: string;
  bet: number;
  battle_id: number | null;
  created_at: Date;
}

// ===== 金币场「房间」 =====
export type RoomStatus = 'waiting' | 'ready_check' | 'deploy' | 'playing' | 'finished' | 'cancelled';

export interface BattleRoomRow extends RowDataPacket {
  id: number;
  owner_user_id: number;
  guest_user_id: number | null;
  bet: number;
  status: RoomStatus;
  owner_ready: number;
  guest_ready: number;
  owner_deployed: number;
  guest_deployed: number;
  deploy_deadline: number;
  battle_id: number | null;
  winner_user_id: number | null;
  escrowed: number;
  created_at: Date;
  updated_at: Date;
}

/** 房间列表/详情中对用户展示的对手信息 */
export interface RoomPlayerInfo {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  wordCount: number;   // 健康词数量
  coins: number;       // 金币数量
  ready: boolean;
  deployed: boolean;
}

export interface RoomView {
  id: number;
  bet: number;
  status: RoomStatus;
  owner: RoomPlayerInfo;
  guest: RoomPlayerInfo | null;
  deployDeadline: number;  // 布阵截止时间戳（0=未开始）
  deployLeft: number;      // 剩余秒数
  battleId: number | null;
  winnerUserId: number | null;
  myRole: 'owner' | 'guest' | 'spectator';
  createdAt: number;
  /** 布阵阶段：当前玩家自己的出战阵容（仅自己可见，用于前端渲染布阵列表） */
  myTroop?: RoomTroopUnit[];
  /** 对手是否在线（用于前端判断对局是否还活着，避免拉回死房） */
  opponentOnline?: boolean;
}

/** 布阵阶段给前端看的己方单位 */
export interface RoomTroopUnit {
  cardId: number;
  word: string;
  meaning: string;
  pos: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      /** 管理员 id（adminMiddleware 注入） */
      adminId?: number;
    }
  }
}
