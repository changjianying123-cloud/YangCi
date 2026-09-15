<template>
  <view class="page">
    <!-- ======= 大厅 ======= -->
    <view v-if="!snap" class="lobby">
      <!-- 房间内：准备 / 布阵 -->
      <view v-if="room" class="lobby-hero">
        <text class="lobby-title">🀄 房间 #{{ room.id }}</text>
        <text class="lobby-sub">押注 <b>{{ room.bet }}</b> 金币 · 赢家拿走 <b>{{ room.bet * 2 }}</b></text>
        <text class="lobby-sub" v-if="room.status === 'waiting'">把这张桌子留在列表里，等对手坐下就好～</text>
        <view class="room-seats">
          <view class="seat" :class="{ me: room.myRole === 'owner' }">
            <text class="seat-avatar">🧑‍🌾</text>
            <text class="seat-name">{{ room.owner.nickname }}</text>
            <text class="seat-tag">房主</text>
            <text class="seat-stat">📚 {{ room.owner.wordCount }} 词 · 🪙 {{ room.owner.coins }}</text>
            <text class="seat-ready" :class="{ on: room.owner.ready }">{{ room.owner.ready ? '✅ 已准备' : '⏳ 未准备' }}</text>
          </view>
          <text class="seat-vs">VS</text>
          <view v-if="room.guest" class="seat" :class="{ me: room.myRole === 'guest' }">
            <text class="seat-avatar">🧑‍🎓</text>
            <text class="seat-name">{{ room.guest.nickname }}</text>
            <text class="seat-tag">挑战者</text>
            <text class="seat-stat">📚 {{ room.guest.wordCount }} 词 · 🪙 {{ room.guest.coins }}</text>
            <text class="seat-ready" :class="{ on: room.guest.ready }">{{ room.guest.ready ? '✅ 已准备' : '⏳ 未准备' }}</text>
          </view>
          <view v-else class="seat empty">
            <text class="seat-avatar">🪑</text>
            <text class="seat-name">等待对手…</text>
          </view>
        </view>

        <button
          v-if="room.status === 'ready_check' && room.guest && !myReady"
          class="start-btn gold"
          :disabled="busy"
          @click="onToggleReady"
        >✅ 准备（双方准备后扣 {{ room.bet }} 金币）</button>
        <text v-else-if="room.status === 'ready_check' && room.guest" class="lobby-sub">已准备，等待对手…</text>
        <text v-else-if="room.status === 'waiting'" class="lobby-sub">等待对手坐下…（{{ roomWaitSec }}s）</text>
        <view v-else-if="room.status === 'finished' || room.status === 'cancelled'" class="room-over">
          <text class="room-over-title">🏁 本局已结束</text>
          <text class="room-over-sub">押注已结算，可以重新开一局</text>
          <button class="start-btn gold" @click="restart">🔄 返回大厅</button>
        </view>

        <!-- 布阵阶段：2 分钟倒计时 + 调整站位 -->
        <view v-if="room.status === 'deploy'" class="room-deploy">
          <text class="room-deploy-tip">🎯 布阵阶段 · 剩余 <b>{{ room.deployLeft }}</b> 秒</text>
          <text class="room-deploy-sub">拖动/点击两两交换站位，<b>前 2 位为一线</b>（可出手/被打）</text>
          <view class="room-deploy-list">
            <view
              v-for="(u, i) in roomDeployUnits"
              :key="u.cardId"
              class="room-deploy-item"
              :class="{ picked: deployPick === u.cardId, frontline: i < 2 }"
              @click="pickDeploy(u)"
            >
              <text class="rdi-idx">{{ i + 1 }}</text>
              <view class="rdi-main">
                <text class="rdi-word">{{ u.word }}</text>
                <text class="rdi-pos">{{ posLabel(u.pos) }}</text>
              </view>
              <text v-if="i < 2" class="rdi-line">一线</text>
            </view>
          </view>
          <button class="start-btn gold" :disabled="deploying" @click="onDeploy">
            {{ deploying ? '提交中…' : (room.owner && room.owner.deployed) || (room.guest && room.guest.deployed) ? '✅ 我已布阵（等对手）' : '⚔️ 确认布阵' }}
          </button>
          <text class="room-deploy-sub">双方都布阵后自动开战；超时也会自动开战</text>
        </view>

        <text class="lobby-back" @click="onLeaveRoom">← 离开房间</text>
        <text v-if="msg" class="lobby-msg">{{ msg }}</text>
      </view>

      <!-- 金币场：房间列表（房间制） -->
      <view v-else-if="mode === 'gold'" class="lobby-hero">
        <text class="lobby-title">💰 金币场</text>
        <text class="lobby-sub">真人房间 · 只显示中文 · 凭记忆拼写英文</text>
        <text class="lobby-sub">赢家通吃：双方各押注，胜者拿走 <b>2×押注</b> 金币</text>
        <text v-if="!wsReady" class="lobby-msg warn">⚠️ 实时连接中…（{{ wsState }}）</text>

        <!-- 我的押注档位 + 开房 -->
        <view class="create-row">
          <text class="create-label">押注</text>
          <view class="bet-list compact">
            <view
              v-for="b in betOptions"
              :key="b"
              class="bet-item"
              :class="{ picked: bet === b }"
              @click="bet = b"
            >
              <text class="bet-coin">🪙</text>
              <text class="bet-num">{{ b }}</text>
            </view>
          </view>
        </view>
        <button class="start-btn gold" :disabled="creating" @click="onCreateRoom">
          {{ creating ? '创建中…' : '➕ 创建房间（押 ' + bet + ' 金币）' }}
        </button>

        <!-- 房间列表（模拟桌子 + 两个座位） -->
        <view class="room-head">
          <text class="room-head-title">🀄 牌桌大厅（{{ rooms.length }} 桌）</text>
          <text class="room-refresh" @click="loadRooms()">🔄 刷新</text>
        </view>
        <view v-if="!rooms.length" class="room-empty">
          暂无可加入的牌桌（每 3 秒自动刷新）
          <text class="room-empty-tip">点上面「创建房间」开一桌，或稍等别人开桌～</text>
          <text class="room-empty-tip">诊断：{{ roomsRaw }}</text>
        </view>
        <view v-for="r in rooms" :key="r.id" class="table-card" :class="'tb-' + r.status">
          <!-- 桌头：房间号 + 押注 + 状态 -->
          <view class="table-top">
            <text class="table-no">#{{ r.id }} 桌</text>
            <text class="table-bet">🪙 {{ r.bet }} / 局</text>
            <text class="table-status" :class="'st-' + r.status">{{ roomStatusText(r.status) }}</text>
          </view>
          <!-- 桌面：左右两个座位 -->
          <view class="table-seats">
            <view class="mini-seat filled" :class="{ me: r.myRole === 'owner' }">
              <text class="ms-avatar">🧑‍🌾</text>
              <text class="ms-name">{{ r.owner.nickname }}</text>
              <text class="ms-role">房主</text>
              <text class="ms-stat">📚{{ r.owner.wordCount }} · 🪙{{ r.owner.coins }}</text>
              <text v-if="r.owner.ready" class="ms-ready">✅ 已准备</text>
            </view>
            <text class="table-vs">VS</text>
            <view v-if="r.guest" class="mini-seat filled" :class="{ me: r.myRole === 'guest' }">
              <text class="ms-avatar">🧑‍🎓</text>
              <text class="ms-name">{{ r.guest.nickname }}</text>
              <text class="ms-role">挑战者</text>
              <text class="ms-stat">📚{{ r.guest.wordCount }} · 🪙{{ r.guest.coins }}</text>
              <text v-if="r.guest.ready" class="ms-ready">✅ 已准备</text>
            </view>
            <view v-else class="mini-seat empty" @click="r.status === 'waiting' && r.myRole === 'spectator' && onJoinRoom(r)">
              <text class="ms-avatar">🪑</text>
              <text class="ms-name">空座</text>
              <text class="ms-role">{{ r.myRole === 'spectator' && r.status === 'waiting' ? '点此坐下' : '等待对手' }}</text>
            </view>
          </view>
          <!-- 操作 -->
          <button
            v-if="r.status === 'waiting' && r.myRole === 'spectator'"
            class="room-join"
            @click="onJoinRoom(r)"
          >🪑 坐下对战</button>
          <text v-else-if="r.myRole === 'owner'" class="room-tip">👉 你的桌子，等待对手坐下…</text>
          <text v-else-if="r.myRole === 'guest'" class="room-tip">👉 你已坐在这桌</text>
          <text v-else class="room-tip">👀 观战中</text>
        </view>

        <text class="lobby-back" @click="leaveGoldLobby">← 返回</text>
        <text v-if="msg" class="lobby-msg">{{ msg }}</text>
      </view>

      <!-- 模式选择 -->
      <view v-else class="lobby-hero">
        <text class="lobby-title">⚔️ 单词对战</text>
        <text class="lobby-sub">派出你「健康&已收服」的单词组队，拼写即出招！</text>
        <view class="mode-list">
          <view class="mode-card" @click="onStart">
            <text class="mode-icon">🥚</text>
            <text class="mode-name">新手场</text>
            <text class="mode-desc">挑战 AI · 显示英文 · 免费练习</text>
          </view>
          <view class="mode-card gold" @click="enterGold">
            <text class="mode-icon">💰</text>
            <text class="mode-name">金币场</text>
            <text class="mode-desc">真人房间 · 只显中文 · 押注对赌</text>
          </view>
        </view>
        <text v-if="msg" class="lobby-msg">{{ msg }}</text>
      </view>

      <view class="rules-card">
        <text class="rules-title">词性 = 技能</text>
        <view class="rule"><text class="tag n">名词</text><text class="rt">拼对 → 给自己或队友叠屏障（放盾量 = 1 + 自身护盾强度，每层挡一次攻击）</text></view>
        <view class="rule"><text class="tag d">形容词</text><text class="rt">拼对 → 给某名词 +1 护盾强度（该名词后续放盾一次多叠 1 层）</text></view>
        <view class="rule"><text class="tag v">动词</text><text class="rt">拼对 → 攻击敌方前排（一击必杀，除非对方有屏障）</text></view>
        <view class="rule"><text class="tag a">副词</text><text class="rt">拼对 → 给某动词 +1 攻击层（每层=破盾时直接击穿击杀）</text></view>
      </view>
      <view class="mini-tip">
        🎯 两军上下交战：上面敌军、下面我军，每方两列、每行 2 个单词。<b>前两行可行动</b>（金色描边=本回合还能出手），下面为后备行（前两行阵亡后自动补位）。
        <br />🛡️ <b>一击必杀制</b>：没有血量，屏障就是命。无屏障的词一旦被动词命中就**直接阵亡**。
        <br />⚔️ 屏障每层能挡下一次攻击（最多 3 层）；被破盾的单词本回合无法续盾。
        <br />⚔️ 动词有副词加成时，破盾的同时直接击穿击杀。
        <br />💀 阵亡且没出过手的词，可拼对复活 1 次（无屏障回来）。
        <br />⏱ 每步 30 秒，超时空过。清光对面 / 逼走对方攻击手即胜。
        <br />💰 <b>金币场</b>：只显中文、凭记忆拼写英文；真人实时对战，赢家拿走双方押注。
      </view>
    </view>

    <!-- ======= 战场 ======= -->
    <view v-else class="field">
      <!-- 顶栏 -->
      <view class="topbar">
        <text class="turn-badge" :class="{ mine: isMyGo && deployed }">
          {{ !deployed ? '🚩 布阵中' : snap.over ? (iWin ? '🏆 我方胜利' : iLose ? '💀 我方落败' : '平局') : (isMyGo ? '🎯 你的回合' : (isGold ? '⏳ 对手回合' : '🤖 敌方回合')) }}
        </text>
        <text class="turn-num">第 {{ snap.turn }} 回合</text>
      </view>

      <!-- 倒计时：我方回合=绿/红，敌方回合=橙（思考中） -->
      <view v-if="deployed && !snap.over" class="timer">
        <view class="timer-fill" :style="{ width: timerPct + '%', background: isMyGo ? (deadTimer ? '#e53935' : '#4caf50') : '#ff9800' }" />
        <text class="timer-txt">{{ isMyGo ? timer + 's' : (isGold ? '对手思考中 ' + timer + 's' : '敌方思考中 ' + timer + 's') }}</text>
      </view>

      <!-- 战场：上下纵向交战（上=敌方，下=我方），每方两列网格 -->
      <view class="battlefield" :class="{ frozen: !deployed }">
        <view class="army enemy-army">
          <SideUnits :side="foeSideView" :teamLabel="enemyLabel" :isCurrent="deployed && !isMyGo"
            :targetIds="deployed ? enemyTargetable : []" :reviveActive="false"
            :troopCount="foe ? foe.units.length : 0" :flip="true"
            @unit-click="onEnemyUnitClick" />
        </view>
        <view class="divider">
          <text class="vs-txt">⚔ 交战 ⚔</text>
        </view>
        <view class="army my-army">
          <SideUnits :side="playerSideView" :teamLabel="myLabel" :isCurrent="deployed && isMyGo"
            :targetIds="deployed ? myTargetable : []" :reviveActive="deployed && isMyGo"
            :actableIds="deployed && isMyGo ? myActable.map((x) => x.cardId) : []"
            :troopCount="me ? me.units.length : 0"
            @unit-click="onMyUnitClick" @revive="onReviveUnit" />
        </view>
      </view>

      <!-- 布阵阶段：拖阵/点选换位，展示全部参战单词 -->
      <view v-if="!deployed" class="deploy-bar">
        <text class="deploy-tip">🎯 排站位：队列顺序 = 站位。<b>前 2 位为一线</b>（可行动 / 先挨打），后方为后备。点两个单词可互换位置。核对敌军阵容后开战。</text>
        <view class="deploy-list">
          <view
            v-for="(u, i) in deployUnits"
            :key="u.cardId"
            class="deploy-item"
            :class="{ picked: deployPick === u.cardId, frontline: i < 2 }"
            @click="pickDeploy(u)"
          >
            <text class="di-idx">{{ i + 1 }}</text>
            <text class="di-word">{{ u.word }}</text>
            <text class="di-role">{{ roleZh(u.role) }}</text>
            <text class="di-pos">{{ i < 2 ? '一线' : '后备' }}</text>
          </view>
        </view>
        <button class="deploy-btn" :disabled="deploying" @click="onDeploy">{{ deploying ? '…' : '🚩 开战！' }}</button>
      </view>

      <!-- 行动提示 -->
      <view v-else class="hint-box">
        <text v-if="isMyGo && !snap.over" class="hint-live">{{ hint }}</text>
        <text v-else-if="!snap.over" class="hint-wait">敌方行动中…</text>
        <text v-else class="hint-over">{{ snap.reason }}</text>
        <button v-if="selected" class="cbtn" @click="resetAction">取消</button>
      </view>

      <!-- 战斗日志 -->
      <scroll-view class="log" scroll-y>
        <text v-for="(lg, i) in snap.log" :key="i" class="log-line">{{ lg }}</text>
      </scroll-view>

      <!-- 战斗结束：结果面板 + 再来一局 -->
      <view v-if="snap.over" class="result-mask">
        <view class="result-panel">
          <text class="res-emoji">{{ iWin ? '🏆' : iLose ? '💀' : '🤝' }}</text>
          <text class="res-title" :class="iWin ? 'win' : iLose ? 'lose' : 'draw'">
            {{ iWin ? '我方胜利！' : iLose ? '我方落败' : '平局' }}
          </text>
          <text v-if="isGold && iWin" class="res-coin">💰 赢得 {{ (snap.bet || 0) * 2 }} 金币</text>
          <text v-else-if="isGold && iLose" class="res-coin lose">💸 失去 {{ snap.bet || 0 }} 金币</text>
          <text class="res-reason">{{ snap.reason }}</text>
          <view class="res-stat">
            <view class="rs-col">
              <text class="rs-label">我方阵亡</text>
              <text class="rs-val dead">{{ me ? me.units.filter(u => u.dead).length : 0 }}</text>
            </view>
            <view class="rs-col">
              <text class="rs-label">敌方阵亡</text>
              <text class="rs-val">{{ foe ? foe.units.filter(u => u.dead).length : 0 }}</text>
            </view>
            <view class="rs-col">
              <text class="rs-label">总回合</text>
              <text class="rs-val">{{ snap.turn }}</text>
            </view>
          </view>
          <button class="res-again" @click="restart">🚩 再来一局</button>
        </view>
      </view>

      <!-- 拼写弹窗 -->
      <view v-if="spellWin" class="mask" @click.self="spellWin = false">
        <view class="spell-panel">
          <text class="sp-title">{{ spellTitle }}</text>
          <view class="sp-mean">
            <text v-if="!isGold" class="sp-w">{{ spellWord }}</text>
            <text class="sp-zh">{{ spellMeaning }}</text>
          </view>
          <input class="sp-input" v-model="spellInput" :placeholder="isGold ? '凭记忆拼写英文…' : '拼写提示：' + spellHint" focus />
          <view class="sp-btns">
            <button class="sp-cancel" @click="spellWin = false">取消</button>
            <button class="sp-go" :disabled="!spellInput.trim()" @click="commitSpell">发动</button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import store from '@/store/index.js';
import * as battleApi from '@/api/battle.js';
import SideUnits from './side.vue';

const ROLE_ZH = { noun: '名词', adjective: '形容词', verb: '动词', adverb: '副词' };
const TURN_SECONDS = 30;

export default {
  components: { SideUnits },
  data() {
    return {
      battleId: null,
      snap: null,
      starting: false,
      mode: '',        // ''=未选 | 'gold'=金币场（新手场即 onStart 直接开）
      bet: 10,          // 金币场押注金额
      betOptions: [10, 30, 50, 100, 200],
      // ===== 新房制金币场 =====
      rooms: [],         // 房间列表
      roomsRaw: '',      // 诊断：接口原始返回
      room: null,        // 我所在/观看的房间
      creating: false,
      busy: false,
      roomWaitSec: 0,
      _roomTick: null,
      _roomsPoll: null,
      ws: null,
      wsReady: false,
      wsState: '未连接',
      _wsRetry: null,
      deployed: false,   // 布阵阶段：展示全部参战单词，确认后再开战
      deployOrder: [],   // 布阵时我方出场顺序（cardId 数组）
      deployPick: null,  // 当前选中待交换位置的单词 cardId
      roomDeployOrder: [], // 房间制布阵顺序（cardId 数组）
      _enteredBattleId: null, // 已进入的对局 id（防重复重建战场）
      deploying: false,
      msg: '',
      // 我方行动状态
      selected: null,      // 我方被选中要行动的 word cardId
      targetPhase: false,  // 正在选目标
      // 拼写弹窗
      spellWin: false,
      spellPayload: null,  // {kind:'skill'|'revive', unitCardId, targetCardId}
      spellWord: '',
      spellMeaning: '',
      spellRole: '',
      spellInput: '',
      acting: false,
      // 本地倒计时
      timer: TURN_SECONDS,
      turnLen: TURN_SECONDS,
      _turnStart: 0,      // 本回合开始时的本地时间戳
      _tick: null,
      _poll: null,
      _polling: false,
    };
  },
  computed: {
    // 真人 PvP：我可能是 side0(player) 或 side1(enemy)
    // 视角归一：我方的 side 索引（0=player, 1=enemy）
    mySideIdx() {
      if (!this.snap) return 0;
      const uid = store.state.user && store.state.user.id;
      if (this.snap.enemy && this.snap.enemy.userId > 0 && this.snap.enemy.userId === uid) return 1;
      return 0;
    },
    // 我方 / 敌方（按视角归一）
    me() {
      if (!this.snap) return null;
      return this.mySideIdx === 1 ? this.snap.enemy : this.snap.player;
    },
    foe() {
      if (!this.snap) return null;
      return this.mySideIdx === 1 ? this.snap.player : this.snap.enemy;
    },
    isGold() {
      return !!(this.snap && this.snap.mode === 'gold');
    },
    isMyGo() {
      return this.deployed && !!this.snap && !this.snap.over && this.snap.currentSide === this.mySideIdx;
    },
    deadTimer() {
      return this.timer <= 5;
    },
    timerPct() {
      return Math.max(0, Math.min(100, (this.timer / this.turnLen) * 100));
    },
    myFront() {
      if (!this.snap || !this.me) return [];
      const q = this.me.queue.slice(0, 2); // 前两行 = 可行动
      return q.map((id) => this.me.units.find((x) => x.cardId === id)).filter((x) => x && !x.dead);
    },
    myStanding() {
      if (!this.snap || !this.me) return [];
      return this.me.queue.map((id) => this.me.units.find((x) => x.cardId === id)).filter((x) => x && !x.dead);
    },
    enemyFront2() {
      if (!this.snap || !this.foe) return [];
      return this.foe.queue.slice(0, 2)
        .map((id) => this.foe.units.find((x) => x.cardId === id))
        .filter((x) => x && !x.dead);
    },
    myLabel() {
      return (this.me && this.me.nickname) || '我方';
    },
    enemyLabel() {
      return (this.foe && this.foe.nickname) || '敌方';
    },
    // 我方本轮可行动的卡（前两行，本回合未出手）
    myActable() {
      return this.myFront.filter((u) => !u.usedSkill);
    },
    // 胜负（按我方视角归一）
    iWin() {
      return !!this.snap && this.snap.over && this.snap.winner === this.mySideIdx;
    },
    iLose() {
      return !!this.snap && this.snap.over && this.snap.winner != null && this.snap.winner !== this.mySideIdx;
    },
    // 布阵阶段：按 deployOrder 渲染我方参战单词（全部）
    deployUnits() {
      const us = (this.me && this.me.units) || [];
      const byId = {};
      us.forEach((u) => { byId[u.cardId] = u; });
      const ordered = this.deployOrder.map((id) => byId[id]).filter(Boolean);
      // 兜底：把未列入顺序的也补上
      us.forEach((u) => { if (!this.deployOrder.includes(u.cardId)) ordered.push(u); });
      return ordered;
    },
    // 房间制布阵阶段：按本地 roomDeployOrder 渲染（数据源：room.myTroop）
    roomDeployUnits() {
      const us = (this.room && this.room.myTroop) || [];
      if (!us.length) return [];
      const byId = {};
      us.forEach((u) => { byId[u.cardId] = u; });
      const ordered = this.roomDeployOrder.map((id) => byId[id]).filter(Boolean);
      us.forEach((u) => { if (!this.roomDeployOrder.includes(u.cardId)) ordered.push(u); });
      return ordered;
    },
    // 战场视图：布阵阶段用 deployOrder 实时反映站位，开战后用服务端队列（我方）
    playerSideView() {
      if (!this.me) return { queue: [], units: [] };
      if (this.deployed) return this.me;
      return Object.assign({}, this.me, { queue: this.deployUnits.map((u) => u.cardId) });
    },
    // 战场视图（敌方，不受布阵影响）
    foeSideView() {
      if (!this.foe) return { queue: [], units: [] };
      return this.foe;
    },
    // 当前可点成目标的高亮卡
    myTargetable() {
      if (!this.selected || !this.targetPhase) return [];
      const role = this.selRole();
      if (role === 'verb') return []; // 动词目标是敌方
      const me = this.myStanding;
      // 名词可保护任意我方(默认自己)；形容词只能选名词；副词只能选动词
      if (role === 'adjective') return me.filter((x) => x.role === 'noun').map((x) => x.cardId);
      if (role === 'adverb') return me.filter((x) => x.role === 'verb').map((x) => x.cardId);
      return me.map((x) => x.cardId); // noun: 任意
    },
    enemyTargetable() {
      if (!this.selected || !this.targetPhase) return [];
      return this.selRole() === 'verb' ? this.enemyFront2.map((x) => x.cardId) : [];
    },
    hint() {
      if (this.acting) return '出招中…';
      if (!this.selected) {
        if (!this.myActable.length) return '前两行单词本回合都已出招，等待下一回合…';
        return `点击前两行的单词出招（还可行动 ${this.myActable.length} 个），拼写正确即触发词性技能`;
      }
      const role = this.selRole();
      if (!this.targetPhase) return this.readyDescribe(role);
      if (role === 'noun') return '选择要保护/叠盾的己方单词（可点自己）';
      if (role === 'adjective') return '点击一个己方名词给它加护盾';
      if (role === 'adverb') return '点击一个己方动词给它加攻击';
      if (role === 'verb') return '点击敌方前两行目标发起攻击';
      return '';
    },
    // 我是否已准备
    myReady() {
      if (!this.room || !this.room.guest) return false;
      return this.room.myRole === 'owner' ? this.room.owner.ready : this.room.guest.ready;
    },
    // 拼写弹窗的标题
    spellTitle() {
      const u = this.spellPayload && this.spellPayload.kind;
      if (u === 'revive') return '✝️ 拼写正确即可复活';
      return `${this.spellRole} 出招 — 拼写这个单词`;
    },
    // 拼写弹窗的提示：只给首字母 + 长度，不泄露答案
    spellHint() {
      const w = (this.spellWord || '').trim();
      if (!w) return '';
      const rest = w.slice(1).replace(/[a-zA-Z]/g, '_');
      return `${w[0]}${rest}（${w.length} 个字母）`;
    },
  },
  onShow() {
    store.ensureLogin();
    if (this.deployed) this.$nextTick(() => this.startTicking());
  },
  onLoad() {
    this.initWs();
    // 断线/重新进入页面时恢复未结束的房间（含布阵阶段）
    this.recoverRoom();
  },
  onUnload() {
    this.stopTicking();
    this.clearRoomTimers();
    this.closeWs();
    // 注意：不在这里主动取消房间！
    // HBuilderX 开发工具/切页会频繁触发 onUnload，若取消会导致「开好桌后消失」。
    // 房间的清理由：①玩家明确点「离开房间」 ②断线/超时判负 ③对手离开。
  },
  watch: {
    // 回合变化（含敌方→我方）时刷新本地倒计时
    'snap.turn'() {
      this.syncTimerFromSnap();
    },
    'snap.currentSide'() {
      this.syncTimerFromSnap();
    },
  },
  methods: {
    // 词性 → 中文标签
    posLabel(pos) {
      const map = { noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词' };
      return map[String(pos || '').toLowerCase()] || pos || '';
    },
    // 房间状态文案
    roomStatusText(st) {
      return { waiting: '等待中', ready_check: '准备阶段', deploy: '布阵中', playing: '对战中', finished: '已结束', cancelled: '已取消' }[st] || st;
    },
    // 断线/重新进入页面时恢复未结束的房间（含布阵阶段）
    async recoverRoom() {
      try {
        const res = await battleApi.roomMine(true);
        const room = res && res.data && res.data.room;
        if (!room) return;
        if (room.status === 'finished' || room.status === 'cancelled') return;
        // 只恢复「还活着」的房间：waiting / ready_check / deploy，或对手在线的对局中
        // 否则会把已开局的死房拉回来（卡死）
        if (room.status === 'playing' && !room.opponentOnline) return;
        this.mode = 'gold';
        this.applyRoom(room);
        this.wsJoinRoom(room.id);
      } catch (e) { /* ignore */ }
    },
    // 依据服务端 activeUntil 重置本地倒计时（含设备时钟偏差兜底）；双方回合都计时
    syncTimerFromSnap() {
      const s = this.snap;
      if (!s || s.over) return;
      const total = s.turnSeconds || TURN_SECONDS;
      const serverLeft = s.activeUntil
        ? Math.max(0, Math.ceil((s.activeUntil - Date.now()) / 1000))
        : total;
      this.turnLen = Math.min(serverLeft, total);
      this.timer = this.turnLen;
      this._turnStart = Date.now();
    },
    selUnit() {
      if (!this.me || this.selected == null) return null;
      return this.me.units.find((x) => x.cardId === this.selected);
    },
    selRole() {
      const u = this.selUnit();
      return u ? u.role : '';
    },
    startTicking() {
      this.stopTicking();
      this.timer = TURN_SECONDS;
      this.turnLen = TURN_SECONDS;
      this._tick = setInterval(() => {
        if (!this.snap || this.snap.over) { this.stopTicking(); return; }
        // 双方回合都用本地回合开始时间计算剩余秒数
        const elapsed = Math.floor((Date.now() - this._turnStart) / 1000);
        this.timer = Math.max(0, this.turnLen - elapsed);
        // 计时归零：我方则空过、敌方则催服务端推进
        if (this.timer === 0 && !this._polling) this.softPoll();
      }, 500);
      this._poll = setInterval(() => {
        if (!this.snap || this.snap.over) { this.stopTicking(); return; }
        this.softPoll();
      }, 3000);
    },
    stopTicking() {
      if (this._tick) clearInterval(this._tick);
      if (this._poll) clearInterval(this._poll);
      this._tick = null;
      this._poll = null;
    },
    // ===== 金币场：房间制 + WebSocket =====
    myUserId() {
      return store.state.user && store.state.user.id;
    },
    // ---------- WebSocket ----------
    wsUrl() {
      // 小程序环境：本地开发用 localhost；真机需换成已备案的 wss:// 域名
      return 'ws://localhost:3000/ws';
    },
    initWs() {
      this.closeWs();
      const token = uni.getStorageSync('yangci_token');
      if (!token) { this.wsState = '未登录'; return; }
      this.wsState = '连接中…';
      let task;
      try {
        task = uni.connectSocket({ url: this.wsUrl() + '?token=' + encodeURIComponent(token), complete: () => {} });
      } catch (e) {
        this.wsState = '连接失败';
        return;
      }
      this.ws = task;
      task.onOpen(() => {
        this.wsReady = true;
        this.wsState = '已连接';
      });
      task.onMessage((res) => {
        let m;
        try { m = JSON.parse(res.data); } catch (e) { return; }
        this.handleWs(m);
      });
      task.onClose(() => {
        this.wsReady = false;
        this.wsState = '已断开';
        this.ws = null;
        // 自动重连（大厅/房间内才需要）
        if (this.mode === 'gold' || this.room) {
          setTimeout(() => { if (!this.ws) this.initWs(); }, 3000);
        }
      });
      task.onError(() => {
        this.wsReady = false;
        this.wsState = '连接异常';
      });
    },
    closeWs() {
      if (this.ws) {
        try { this.ws.close({}); } catch (e) { /* ignore */ }
        this.ws = null;
      }
      this.wsReady = false;
    },
    wsSend(obj) {
      if (this.ws && this.wsReady) {
        try { this.ws.send({ data: JSON.stringify(obj) }); } catch (e) { /* ignore */ }
      }
    },
    wsJoinRoom(roomId) {
      this.wsSend({ type: 'join_room', roomId });
    },
    async handleWs(m) {
      const d = m.data || {};
      if (m.type === 'rooms_changed') {
        if (this.mode === 'gold' && !this.room) this.loadRooms(true);
      } else if (m.type === 'room_update') {
        this.applyRoom(d);
      } else if (m.type === 'room_closed') {
        this.onRoomClosed(d);
      } else if (m.type === 'room_finished') {
        this.msg = d.win
          ? `🏆 恭喜获胜！赢得 ${d.pot} 金币${d.reason ? '（' + d.reason + '）' : ''}`
          : `💔 你败了${d.reason ? '（' + d.reason + '）' : ''}`;
        // 房间已结束：标记状态并停掉定时器
        if (this.room) {
          this.room = Object.assign({}, this.room, { status: 'finished' });
          this.clearRoomTimers();
        }
        // 拉最新快照以展示结算面板（含在场对局中途结束的情况）
        const bid = d.battleId || (this.room && this.room.battleId) || this.battleId;
        if (bid) {
          try {
            const res = await battleApi.getBattle(bid, true);
            const snap = res && res.data && res.data.snap;
            if (snap) {
              this.battleId = bid;
              this.deployed = true;
              this.applySnap(snap);
              this.stopTicking();
            }
          } catch (e) { /* ignore */ }
        }
        this.msgToast(d.win ? '🏆 对手离开，你获胜！' : '💔 你已判负');
      } else if (m.type === 'room_error') {
        this.msg = '⚠️ ' + (d.msg || '房间出错');
        this.busy = false;
      }
    },
    applyRoom(room) {
      const prevStatus = this.room && this.room.status;
      this.room = room;
      // 已进入对局界面（有快照）时，不再用房间状态回退界面
      if (this.snap) return;
      if (room.status === 'deploy' && prevStatus !== 'deploy') {
        this.msg = '🎯 双方已准备，进入布阵阶段（2 分钟）！';
        this.deployPick = null;
        // 首次进入布阵：以服务端给的阵容顺序初始化本地布阵顺序
        this.roomDeployOrder = (room.myTroop || []).map((u) => u.cardId);
        // 布阵倒计时：每秒基于 deployDeadline 刷新
        if (this._roomTick) clearInterval(this._roomTick);
        this._roomTick = setInterval(() => { this.tickRoomDeploy(); }, 1000);
      }
      if (room.status === 'deploy' && this._roomTick && room.deployDeadline) {
        this.room.deployLeft = Math.max(0, Math.ceil((room.deployDeadline - Date.now()) / 1000));
      }
      // 开战 → 进入对战界面（只进一次，避免重复重建）
      if (room.status === 'playing' && room.battleId && this._enteredBattleId !== room.battleId) {
        this._enteredBattleId = room.battleId;
        this.enterGoldBattle(room.battleId);
      }
    },
    tickRoomDeploy() {
      if (!this.room || this.room.status !== 'deploy' || !this.room.deployDeadline) return;
      this.room.deployLeft = Math.max(0, Math.ceil((this.room.deployDeadline - Date.now()) / 1000));
    },
    onRoomClosed(d) {
      this.msg = d.reason === 'opponent_left' ? '对手已离开房间' : (d.reason || '房间已关闭');
      if (d.refunded) this.msg += `（已退还 ${d.refunded} 金币）`;
      this.room = null;
      this.loadRooms(true);
    },
    // ---------- 大厅 ----------
    enterGold() {
      this.mode = 'gold';
      this.msg = '';
      if (!this.ws) this.initWs();
      this.loadRooms();
      if (this._roomsPoll) clearInterval(this._roomsPoll);
      this._roomsPoll = setInterval(() => { this.loadRooms(true); }, 3000);
    },
    leaveGoldLobby() {
      // 若正在对局中（已有快照）→ 回大厅视为认输（判负，对手拿底池）
      if (this.room && (this.room.status === 'playing' || this.snap)) {
        const rid = this.room.id;
        try { battleApi.roomLeave(rid, 'home'); } catch (e) { /* ignore */ }
        this.room = null;
        this.snap = null;
        this.battleId = null;
        this.deployed = false;
        this._enteredBattleId = null;
        this.stopTicking();
        this.wsJoinRoom(0);
      }
      this.mode = '';
      this.clearRoomTimers();
      // 未开战的房间保留（只是退出列表视图，桌子继续开放，等随时回来）
      this.loadRooms();
    },
    async loadRooms(quiet) {
      try {
        const res = await battleApi.roomList();
        this.rooms = (res && res.data && res.data.rooms) || [];
        this.roomsRaw = res && res.data ? ('code=' + res.code + ' rooms=' + JSON.stringify((res.data.rooms || []).map(r => r.id))) : ('无data:' + JSON.stringify(res));
      } catch (e) {
        this.roomsRaw = 'err:' + ((e && (e.msg || e.message)) || JSON.stringify(e));
        if (!quiet) this.msg = (e && (e.msg || e.message)) || '加载房间列表失败';
      }
    },
    async onCreateRoom() {
      this.msg = '';
      this.creating = true;
      try {
        const res = await battleApi.roomCreate(this.bet);
        this.creating = false;
        const room = res && res.data && res.data.room;
        if (room) {
          this.applyRoom(room);
          this.wsJoinRoom(room.id);
          this.startRoomWaitTick();
        }
      } catch (e) {
        this.creating = false;
        this.msg = (e && (e.msg || e.message)) || '创建房间失败';
      }
    },
    async onJoinRoom(r) {
      this.msg = '';
      this.busy = true;
      try {
        const res = await battleApi.roomJoin(r.id);
        this.busy = false;
        const room = res && res.data && res.data.room;
        if (room) {
          this.applyRoom(room);
          this.wsJoinRoom(room.id);
        }
      } catch (e) {
        this.busy = false;
        this.msg = (e && (e.msg || e.message)) || '加入房间失败';
        this.loadRooms(true);
      }
    },
    async onToggleReady() {
      if (!this.room) return;
      this.msg = '';
      this.busy = true;
      try {
        const res = await battleApi.roomReady(this.room.id);
        this.busy = false;
        const room = res && res.data && res.data.room;
        if (room) this.applyRoom(room);
      } catch (e) {
        this.busy = false;
        this.msg = (e && (e.msg || e.message)) || '准备失败';
      }
    },
    async onLeaveRoom() {
      const rid = this.room && this.room.id;
      if (!rid) { this.room = null; return; }
      try { await battleApi.roomLeave(rid, 'leave'); } catch (e) { /* ignore */ }
      this.room = null;
      this.clearRoomTimers();
      this.loadRooms(true);
    },
    startRoomWaitTick() {
      this.roomWaitSec = 0;
      if (this._roomTick) clearInterval(this._roomTick);
      this._roomTick = setInterval(() => { this.roomWaitSec += 1; }, 1000);
    },
    clearRoomTimers() {
      if (this._roomsPoll) clearInterval(this._roomsPoll);
      if (this._roomTick) clearInterval(this._roomTick);
      this._roomsPoll = null;
      this._roomTick = null;
    },
    async enterGoldBattle(battleId) {
      this.clearRoomTimers();
      this.battleId = battleId;
      // 房间制：双方开战前都已布阵，进战场即为已布阵状态
      this.deployed = true;
      this.deployPick = null;
      try {
        const res = await battleApi.getBattle(battleId, true);
        const snap = res && res.data && res.data.snap;
        if (snap) {
          // 双方各布各阵：deployOrder 取我方队列
          const mine = snap.player.userId === this.myUserId() ? snap.player : snap.enemy;
          this.deployOrder = (mine.queue || []).slice();
          // 房间制：双方都已布阵，直接进入对战（无需再点开战）
          this.applySnap(snap);
          this.startTicking();
        } else {
          this.deployed = false;
        }
      } catch (e) { this.deployed = false; }
    },
    async onStart() {
      this.msg = '';
      this.starting = true;
      try {
        const res = await battleApi.startBattle();
        this.starting = false;        if (res && res.data) {
          this.battleId = res.data.battleId;
          this.deployed = false;   // 先进入布阵阶段
          this.deployPick = null;
          this.deployOrder = ((res.data.snap && res.data.snap.player && res.data.snap.player.queue) || []).slice();
          this.applySnap(res.data.snap);
        } else {
          this.msg = (res && res.msg) || '组队失败';
        }
      } catch (e) {
        this.starting = false;
        this.msg = (e && e.msg) || '无法开始：可能你还没有健康的可出战单词';
      }
    },
    // 布阵：点两个单词互换位置（同时可优化一线站位）
    pickDeploy(u) {
      // 房间制布阵阶段：操作 roomDeployOrder
      const inRoom = this.room && !this.snap && this.room.status === 'deploy';
      const order = inRoom ? this.roomDeployOrder : this.deployOrder;
      if (this.deployPick == null) { this.deployPick = u.cardId; return; }
      if (this.deployPick === u.cardId) { this.deployPick = null; return; }
      const i = order.indexOf(this.deployPick);
      const j = order.indexOf(u.cardId);
      if (i >= 0 && j >= 0) {
        const arr = order.slice();
        [arr[i], arr[j]] = [arr[j], arr[i]];
        if (inRoom) this.roomDeployOrder = arr; else this.deployOrder = arr;
      }
      this.deployPick = null;
    },
    roleZh(r) { return ROLE_ZH[r] || r || ''; },
    // 布阵完成 → 提交站位（房间制：双方都提交则开战；新手场：直接开战）
    async onDeploy() {
      this.deploying = true;
      try {
        // 房间制金币场：提交到房间接口（注意：布阵阶段还没有 snap，不能用 isGold 判定）
        if (this.room && !this.snap) {
          const order = this.roomDeployOrder.length ? this.roomDeployOrder : (this.room.myTroop || []).map((u) => u.cardId);
          const res = await battleApi.roomDeploy(this.room.id, order);
          const d = (res && res.data) || {};
          if (d.room) this.applyRoom(d.room);
          if (d.battleId) {
            // 双方都提交了 → 已开战
            this.enterGoldBattle(d.battleId);
          } else {
            this.msgToast('已提交布阵，等待对手排兵…');
          }
          this.deploying = false;
          return;
        }
        const res = await battleApi.deployBattle(this.battleId, this.deployOrder);
        if (res && res.data && res.data.snap) {
          this.deployed = true;
          this.applySnap(res.data.snap);
          this.syncTimerFromSnap();
          this.startTicking();
        } else {
          this.msgToast((res && res.msg) || '开战失败');
        }
      } catch (e) {
        this.msgToast((e && (e.msg || e.message)) || '开战失败');
      }
      this.deploying = false;
    },
    applySnap(s) {
      if (!s) return;
      this.snap = s;
      this.resetAction();
      this.syncTimerFromSnap();
    },
    async softPoll() {
      if (!this.deployed || !this.battleId || !this.snap || this._polling) return;
      this._polling = true;
      try {
        const res = await battleApi.getBattle(this.battleId);
        // 静默模式下失败也走 resolve，这里兜一层：只有真的拿到快照才应用
        if (res && res.data && res.data.snap) {
          const s = res.data.snap;
          const changed = !this.snap || s.turn !== this.snap.turn || s.currentSide !== this.snap.currentSide;
          // 敌方(AI)在服务端行动 → 轮询时把新增日志吐司出来，让玩家看到敌方做了什么
          const beforeLen = ((this.snap && this.snap.log) || []).length;
          const newLogs = (s.log || []).slice(beforeLen);
          this.snap = s;
          // 只对敌方日志吐司，避免重复提示我方动作
          const foeLogs = newLogs.filter((l) => {
            const s = String(l);
            if (this.isGold) {
              // 真人局：带有我方昵称的日志是我自己的，其余为对手
              const myName = (this.me && this.me.nickname) || '';
              return !!myName && s.indexOf(myName) < 0;
            }
            return s.indexOf('🤖') >= 0;
          });
          if (foeLogs.length) this.toastAction(foeLogs, true);
          // 只在“回合真的变了”时重建倒计时，避免轮询把秒数刷回 30
          if (changed) this.syncTimerFromSnap();
        }
      } catch (e) { /* 网络抖动静默 */ }
      this._polling = false;
    },
    // ---- 点我方单位 ----
    onMyUnitClick(u) {
      if (!this.isMyGo) { this.msgToast('还没轮到你'); return; }
      if (this.acting) return;
      if (u.dead) return;
      // 若正处在“选目标”，点中的若是有效目标就提交
      if (this.selected && this.targetPhase) {
        if (this.myTargetable.includes(u.cardId)) return this.toSpellSkill(u.cardId);
        // 否则视为重新选择前排单位
      }
      if (!this.isFront(u.cardId)) { this.msgToast('该单词不在前两行，等前两行阵亡后会自动前移'); return; }
      if (u.usedSkill) { this.msgToast('该单词本回合已经行动过了，等下一回合'); return; }
      this.selected = u.cardId;
      // 所有词性都先进“选目标”态：名词可点自己、形容词/副词选己方、动词选敌方
      this.targetPhase = true;
      // 名词若队里只有自己一个可用目标，直接进拼写更顺手
      if (u.role === 'noun' && this.myTargetable.length <= 1) {
        return this.toSpellSkill(u.cardId);
      }
    },
    isFront(cardId) {
      if (!this.me) return false;
      return this.me.queue.indexOf(cardId) < 4;
    },
    // 点敌方单位：仅当我在选动词目标
    onEnemyUnitClick(u) {
      if (!this.isMyGo || !this.selected || !this.targetPhase || this.acting) return;
      const role = this.selRole();
      if (role !== 'verb') return;
      if (!this.enemyFront2.some((x) => x.cardId === u.cardId)) { this.msgToast('只能攻击敌方前排的两个单词'); return; }
      this.toSpellSkill(u.cardId);
    },
    // ---- 进入拼写 ----
    toSpellSkill(targetCardId) {
      const u = this.selUnit();
      if (!u) return;
      this.spellPayload = { kind: 'skill', unitCardId: u.cardId, targetCardId };
      this.spellWord = u.word;
      this.spellMeaning = u.meaning;
      this.spellRole = ROLE_ZH[u.role];
      this.spellInput = '';
      this.openSpell();
    },
    // 阵亡复活
    onReviveUnit(u) {
      if (!this.isMyGo || this.acting) return;
      this.spellPayload = { kind: 'revive', unitCardId: u.cardId, targetCardId: null };
      this.spellWord = u.word;
      this.spellMeaning = u.meaning;
      this.spellRole = '复活';
      this.spellInput = '';
      this.openSpell();
    },
    openSpell() { this.targetPhase = false; this.spellWin = true; },
    // ---- 提交 ----
    commitSpell() {
      const payload = this.spellPayload;
      if (!payload) return;
      const correct = (this.spellInput || '').trim().toLowerCase() === (this.spellWord || '').trim().toLowerCase();
      const data = {
        kind: payload.kind,
        unit_card_id: payload.unitCardId,
        spell_correct: correct,
      };
      if (payload.targetCardId != null) data.target_card_id = payload.targetCardId;
      this.spellWin = false;
      this.act(data);
    },
    async act(data) {
      if (this.acting) return;
      this.acting = true;
      const beforeLogs = ((this.snap && this.snap.log) || []).slice();
      try {
        const res = await battleApi.battleAct(this.battleId, data, false);
        if (res && res.data && res.data.snap) {
          const snap = res.data.snap;
          this.applySnap(snap);
          // 行动结果吐司：把本次新增日志拆成「我方动作」和「敌方反击」分别提示
          const newLogs = (snap.log || []).slice(beforeLogs.length);
          let myLogs, foeLogs;
          if (this.isGold) {
            const myName = (this.me && this.me.nickname) || '';
            myLogs = newLogs.filter((l) => !!myName && String(l).indexOf(myName) >= 0);
            foeLogs = newLogs.filter((l) => !myName || String(l).indexOf(myName) < 0);
          } else {
            myLogs = newLogs.filter((l) => String(l).indexOf('🤖') < 0);
            foeLogs = newLogs.filter((l) => String(l).indexOf('🤖') >= 0);
          }
          if (myLogs.length) this.toastAction(myLogs, false);
          if (foeLogs.length) setTimeout(() => this.toastAction(foeLogs, true), 1200);
        } else if (res && res.code && res.code !== 200) this.msgToast(res.msg || '操作失败');
      } catch (e) {
        const m = (e && e.msg) || '操作失败';
        this.msgToast(m);
        this.resetAction();
        this.softPoll();
      }
      this.acting = false;
    },
    // 把本次行动产生的日志用吐司弹出（isEnemy=true 时提示前缀「敌方」）
    toastAction(logs, isEnemy) {
      if (!logs || !logs.length) return;
      const badLine = logs.find((l) => l.indexOf('❌') >= 0);
      let pick = badLine
        || logs.find((l) => l.indexOf('阵亡') >= 0 || l.indexOf('击破屏障') >= 0 || l.indexOf('击杀') >= 0 || l.indexOf('复活') >= 0)
        || logs[logs.length - 1];
      pick = String(pick).trim();
      // 敌方日志已在服务端以 🤖 开头；这里再冠以「敌方」更清楚（金币场用「对手」）
      const prefix = isEnemy ? (this.isGold ? '对手 ' : '敌方 ') : '';
      const title = (isEnemy && pick.indexOf('🤖') < 0 ? prefix : '') + pick;
      uni.showToast({ title: title.slice(0, 30), icon: badLine ? 'error' : 'none', duration: 2400 });
    },
    // 再来一局：回到大厅
    restart() {
      this.stopTicking();
      this.clearRoomTimers();
      // 房间制：主动离开并向服务端释放房间（避免残留）
      const rid = this.room && this.room.id;
      if (rid) {
        try { battleApi.roomLeave(rid, 'home'); } catch (e) { /* ignore */ }
      }
      this.room = null;
      this.mode = '';
      this.battleId = null;
      this.snap = null;
      this.deployed = false;
      this.deployOrder = [];
      this.deployPick = null;
      this.roomDeployOrder = [];
      this._enteredBattleId = null;
      this.msg = '';
      this.wsJoinRoom(0); // 退出房间频道
      this.resetAction();
      this.loadRooms(true);
    },
    resetAction() {
      this.selected = null;
      this.targetPhase = false;
      this.spellPayload = null;
    },
    msgToast(t) {
      uni.showToast({ title: t, icon: 'none', duration: 1600 });
    },
    readyDescribe(role) {
      if (role === 'noun') return '名词：点击一个己方单位（含自己）保护叠盾';
      if (role === 'verb') return '动词：点击敌方前排攻击';
      if (role === 'adjective') return '形容词：点击一个己方名词加盾';
      return '副词：点击一个己方动词加攻击';
    },
  },
};
</script>

<style scoped>
.page { min-height: 100vh; background: linear-gradient(180deg, #0c1626 0%, #12233b 100%); color: #fff; }
/* 大厅 */
.lobby { padding: 30rpx 24rpx 60rpx; }
.lobby-hero { background: linear-gradient(135deg, #1b5fd9, #00c6ff); border-radius: 28rpx; padding: 46rpx 30rpx; text-align: center; }
.lobby-title { font-size: 48rpx; font-weight: 800; display: block; }
.lobby-sub { display: block; color: rgba(255,255,255,.9); font-size: 26rpx; margin: 16rpx 0 28rpx; line-height: 1.6; }
.start-btn { background: #ffd54f; color: #5d4037; font-size: 32rpx; font-weight: bold; border-radius: 44rpx; padding: 6rpx 0; }
.start-btn[disabled] { opacity: .6; }
.lobby-msg { color: #ffe9a8; font-size: 24rpx; display: block; margin-top: 20rpx; }
.lobby-msg.warn { color: #ffcc80; }
/* 房间列表 */
.create-row { display: flex; align-items: center; gap: 14rpx; margin: 6rpx 0 18rpx; }
.create-label { font-size: 26rpx; color: rgba(255,255,255,.9); flex-shrink: 0; }
.bet-list.compact { margin: 0; gap: 10rpx; flex: 1; }
.bet-list.compact .bet-item { min-width: 80rpx; padding: 10rpx 6rpx; }
.bet-list.compact .bet-num { font-size: 28rpx; }
.room-head { display: flex; align-items: center; justify-content: space-between; margin: 28rpx 4rpx 12rpx; }
.room-head-title { font-size: 30rpx; font-weight: 800; color: #ffd54f; }
.room-refresh { font-size: 24rpx; color: #9fd4ff; }
.room-empty { font-size: 24rpx; color: rgba(255,255,255,.65); padding: 30rpx 10rpx; background: rgba(0,0,0,.18); border-radius: 16rpx; }
.room-empty-tip { display: block; margin-top: 10rpx; font-size: 22rpx; color: rgba(255,255,255,.45); }
/* 房间内布阵阶段 */
.room-over { margin: 20rpx 0 10rpx; padding: 24rpx 16rpx; background: rgba(0,0,0,.26); border: 2rpx solid rgba(255,255,255,.2); border-radius: 18rpx; text-align: center; }
.room-over-title { display: block; font-size: 32rpx; font-weight: 800; color: #ffd54f; margin-bottom: 8rpx; }
.room-over-sub { display: block; font-size: 22rpx; color: #9fb6d0; margin-bottom: 16rpx; }
.room-deploy { margin: 16rpx 0 8rpx; padding: 16rpx; background: rgba(0,0,0,.24); border: 2rpx solid rgba(255,167,38,.45); border-radius: 18rpx; }
.room-deploy-tip { display: block; font-size: 27rpx; font-weight: 800; color: #ffb74d; margin-bottom: 6rpx; }
.room-deploy-tip b { color: #ffd54f; font-size: 32rpx; }
.room-deploy-sub { display: block; font-size: 21rpx; color: #9fb6d0; line-height: 1.6; margin: 6rpx 0 12rpx; }
.room-deploy-list { display: flex; flex-direction: column; gap: 8rpx; margin-bottom: 14rpx; }
.room-deploy-item { display: flex; align-items: center; gap: 12rpx; padding: 12rpx 14rpx; background: rgba(255,255,255,.06); border: 2rpx solid rgba(255,255,255,.14); border-radius: 14rpx; }
.room-deploy-item.frontline { background: rgba(255,213,79,.1); border-color: rgba(255,213,79,.45); }
.room-deploy-item.picked { border-color: #ffd54f; box-shadow: 0 0 0 2rpx rgba(255,213,79,.6); }
.rdi-idx { width: 40rpx; height: 40rpx; line-height: 40rpx; text-align: center; border-radius: 50%; background: rgba(255,255,255,.2); font-size: 22rpx; font-weight: 800; flex: none; }
.room-deploy-item.frontline .rdi-idx { background: #ffd54f; color: #12243c; }
.rdi-main { flex: 1; min-width: 0; text-align: left; }
.rdi-word { display: block; font-size: 28rpx; font-weight: 700; }
.rdi-pos { display: inline-block; font-size: 19rpx; color: #cfe0f5; background: rgba(255,255,255,.14); border-radius: 8rpx; padding: 1rpx 10rpx; margin-top: 4rpx; }
.rdi-line { flex: none; font-size: 20rpx; font-weight: 800; color: #ffd54f; }
/* 牌桌卡片 */
.table-card { background: linear-gradient(160deg, rgba(20,60,45,.92), rgba(12,40,30,.92)); border: 2rpx solid rgba(120,220,170,.35); border-radius: 22rpx; padding: 18rpx; margin-bottom: 20rpx; text-align: left; box-shadow: 0 6rpx 18rpx rgba(0,0,0,.28); }
.table-card.tb-waiting { border-color: #66bb6a; }
.table-card.tb-ready_check { border-color: #42a5f5; }
.table-card.tb-deploy { border-color: #ffa726; }
.table-card.tb-playing { border-color: #ab47bc; }
.table-top { display: flex; align-items: center; gap: 12rpx; padding-bottom: 12rpx; border-bottom: 1rpx dashed rgba(255,255,255,.18); }
.table-no { font-size: 30rpx; font-weight: 800; color: #ffe082; flex: 1; }
.table-bet { font-size: 24rpx; color: #ffd54f; font-weight: 700; }
.table-status { font-size: 20rpx; padding: 4rpx 14rpx; border-radius: 20rpx; background: rgba(255,255,255,.18); }
.table-status.st-waiting { background: #2e7d32; }
.table-status.st-ready_check { background: #1565c0; }
.table-status.st-deploy { background: #ef6c00; }
.table-status.st-playing { background: #6a1b9a; }
.table-seats { display: flex; align-items: center; gap: 8rpx; padding: 16rpx 0 10rpx; }
.mini-seat { flex: 1; min-width: 0; background: rgba(0,0,0,.26); border: 2rpx solid rgba(255,255,255,.16); border-radius: 16rpx; padding: 14rpx 10rpx; text-align: center; }
.mini-seat.filled { border-color: rgba(120,220,170,.5); }
.mini-seat.me { border-color: #ffd54f; background: rgba(255,213,79,.16); }
.mini-seat.empty { border-style: dashed; border-color: rgba(255,255,255,.3); color: rgba(255,255,255,.7); }
.ms-avatar { display: block; font-size: 40rpx; }
.ms-name { display: block; font-size: 26rpx; font-weight: 800; margin-top: 4rpx; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ms-role { display: inline-block; font-size: 18rpx; color: #cfe0f5; background: rgba(255,255,255,.16); border-radius: 8rpx; padding: 2rpx 10rpx; margin: 6rpx 0; }
.ms-stat { display: block; font-size: 20rpx; color: #b9d4ee; }
.ms-ready { display: block; font-size: 20rpx; color: #81c784; font-weight: 800; margin-top: 4rpx; }
.table-vs { font-size: 24rpx; font-weight: 800; color: #ffd54f; padding: 0 4rpx; }
.room-item { background: rgba(0,0,0,.24); border: 2rpx solid rgba(255,255,255,.16); border-radius: 18rpx; padding: 20rpx; margin-bottom: 16rpx; text-align: left; }
.room-line1 { display: flex; align-items: center; gap: 14rpx; }
.room-owner { font-size: 30rpx; font-weight: 800; flex: 1; }
.room-bet { font-size: 26rpx; color: #ffd54f; font-weight: 800; }
.room-status { font-size: 22rpx; padding: 4rpx 14rpx; border-radius: 20rpx; background: rgba(255,255,255,.18); }
.room-status.st-waiting { background: #2e7d32; }
.room-status.st-ready_check { background: #1565c0; }
.room-status.st-deploy { background: #ef6c00; }
.room-status.st-playing { background: #6a1b9a; }
.room-line2 { display: flex; flex-wrap: wrap; gap: 20rpx; margin: 12rpx 0 4rpx; }
.room-stat { font-size: 24rpx; color: #cfe0f5; }
.room-join { margin-top: 14rpx; background: linear-gradient(135deg, #ffb300, #ffd54f); color: #5d4037; font-size: 28rpx; font-weight: bold; border-radius: 36rpx; padding: 4rpx 0; }
.room-tip { display: block; margin-top: 10rpx; font-size: 24rpx; color: #9fd4ff; }
/* 房间座位 */
.room-seats { display: flex; align-items: stretch; gap: 12rpx; margin: 10rpx 0 26rpx; }
.seat { flex: 1; background: rgba(0,0,0,.24); border: 2rpx solid rgba(255,255,255,.2); border-radius: 18rpx; padding: 20rpx 14rpx; }
.seat.me { border-color: #ffd54f; background: rgba(255,213,79,.18); }
.seat.empty { display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,.6); }
.seat-vs { align-self: center; font-size: 28rpx; font-weight: 800; color: #ffd54f; }
.seat-avatar { display: block; font-size: 44rpx; }
.seat-name { display: block; font-size: 30rpx; font-weight: 800; }
.seat-tag { display: inline-block; font-size: 20rpx; color: #cfe0f5; background: rgba(255,255,255,.16); border-radius: 10rpx; padding: 2rpx 10rpx; margin: 6rpx 0; }
.seat-stat { display: block; font-size: 22rpx; color: #cfe0f5; margin-top: 4rpx; }
.seat-ready { display: block; font-size: 24rpx; margin-top: 8rpx; color: rgba(255,255,255,.7); }
.seat-ready.on { color: #81c784; font-weight: 800; }
/* 模式选择 */
.mode-list { display: flex; flex-direction: column; gap: 20rpx; margin-top: 10rpx; }
.mode-card { background: rgba(255,255,255,.14); border: 2rpx solid rgba(255,255,255,.35); border-radius: 20rpx; padding: 24rpx; text-align: left; }
.mode-card.gold { border-color: #ffd54f; background: rgba(255,213,79,.16); }
.mode-icon { font-size: 40rpx; }
.mode-name { font-size: 34rpx; font-weight: 800; display: block; margin: 6rpx 0; }
.mode-desc { font-size: 24rpx; color: rgba(255,255,255,.85); }
/* 押注档位 */
.bet-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 16rpx; margin: 10rpx 0 24rpx; }
.bet-item { flex: 0 0 auto; min-width: 110rpx; padding: 18rpx 10rpx; border-radius: 16rpx; background: rgba(0,0,0,.22); border: 2rpx solid rgba(255,255,255,.3); text-align: center; }
.bet-item.picked { border-color: #ffd54f; background: rgba(255,213,79,.28); }
.bet-coin { font-size: 26rpx; }
.bet-num { display: block; font-size: 34rpx; font-weight: 800; }
.start-btn.gold { background: linear-gradient(135deg, #ffb300, #ffd54f); }
.start-btn.cancel { background: rgba(255,255,255,.25); color: #fff; }
.lobby-back { display: block; margin-top: 18rpx; color: rgba(255,255,255,.8); font-size: 26rpx; }
.res-coin { display: block; color: #ffd54f; font-size: 30rpx; font-weight: 800; margin-top: 8rpx; }
.res-coin.lose { color: #ff8a80; }
.rules-card { background: #16283f; border-radius: 22rpx; margin-top: 24rpx; padding: 26rpx; }
.rules-title { display: block; font-size: 30rpx; font-weight: bold; margin-bottom: 14rpx; color: #ffd54f; }
.rule { display: flex; align-items: center; gap: 16rpx; padding: 14rpx 0; border-bottom: 1rpx solid rgba(255,255,255,.05); }
.rule:last-child{border:none;}
.tag { color: #fff; font-size: 22rpx; font-weight: bold; width: 100rpx; text-align: center; padding: 6rpx 0; border-radius: 10rpx; flex-shrink:0; }
.tag.n { background: #42a5f5; } .tag.d { background: #66bb6a; } .tag.v { background: #ef5350; } .tag.a { background: #ab47bc; }
.rt { font-size: 24rpx; color: #cfe0f5; line-height: 1.5; }
.mini-tip { font-size: 22rpx; color: #8aa4c4; line-height: 1.8; margin: 26rpx 6rpx; }

/* 战场 */
.field { padding: 12rpx 16rpx 30rpx; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 8rpx 4rpx 14rpx; }
.turn-badge { background: #31445e; font-size: 26rpx; padding: 8rpx 24rpx; border-radius: 26rpx; }
.turn-badge.mine { background: #00897b; }
.turn-num { color: #8aa4c4; font-size: 24rpx; }
.timer { position: relative; height: 34rpx; background: #0b1626; border-radius: 18rpx; overflow: hidden; margin-bottom: 18rpx; }
.timer-fill { height: 100%; transition: width .2s linear; }
.timer-txt { position: absolute; right: 18rpx; top: 4rpx; font-size: 22rpx; font-weight: bold; }

/* 两军上下纵向交战：上=敌方两列，下=我方两列，中间横贯分隔 */
.battlefield { display: flex; flex-direction: column; gap: 8rpx; padding: 6rpx 10rpx 10rpx; }
.army { width: 100%; }
.enemy-army { }
.my-army { }
.divider {
  height: 44rpx; display: flex; align-items: center; justify-content: center;
  position: relative;
}
.divider::before {
  content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 2rpx;
  background: linear-gradient(to right, transparent, #31445e 20%, #31445e 80%, transparent);
  transform: translateY(-50%);
}
.vs-txt {
  position: relative; z-index: 2; background: #e53935; color: #fff; font-weight: bold;
  font-size: 20rpx; padding: 3rpx 18rpx; border-radius: 20rpx; letter-spacing: 1rpx;
}
.hint-box { min-height: 70rpx; padding: 12rpx; text-align: center; }
/* 布阵阶段（冻结战场，不跑回合） */
.battlefield.frozen { opacity: .96; }
.deploy-bar { padding: 14rpx 18rpx 6rpx; text-align: center; }
.deploy-tip { display: block; font-size: 22rpx; color: #8aa4c4; line-height: 1.6; margin-bottom: 12rpx; }
.deploy-list { display: flex; flex-direction: column; gap: 8rpx; margin-bottom: 16rpx; }
.deploy-item {
  display: flex; align-items: center; gap: 12rpx;
  background: #11202f; border: 1rpx solid #24374d; border-radius: 12rpx; padding: 10rpx 14rpx;
}
.deploy-item.frontline { background: rgba(255,213,79,.08); border-color: rgba(255,213,79,.45); }
.deploy-item.picked { border-color: #ffd54f; box-shadow: 0 0 0 2rpx rgba(255,213,79,.6); }
.di-idx { width: 34rpx; height: 34rpx; line-height: 34rpx; text-align: center; border-radius: 50%; background: #24374d; color: #cfd8e8; font-size: 20rpx; }
.deploy-item.frontline .di-idx { background: #ffd54f; color: #12243c; }
.di-word { flex: 1; text-align: left; color: #e8f0ff; font-size: 26rpx; font-weight: bold; }
.di-role { font-size: 20rpx; color: #9fb4d0; }
.di-pos { font-size: 18rpx; color: #12243c; background: #90caf9; border-radius: 14rpx; padding: 2rpx 10rpx; }
.deploy-item.frontline .di-pos { background: #ffd54f; }
.deploy-btn {
  background: linear-gradient(135deg, #e53935, #b71c1c); color: #fff; font-weight: bold;
  font-size: 32rpx; letter-spacing: 4rpx; border-radius: 48rpx; padding: 20rpx 0; width: 70%;
  box-shadow: 0 8rpx 24rpx rgba(229,57,53,.35);
}
.hint-live { color: #ffd54f; font-size: 26rpx; line-height: 1.5; }
.hint-wait { color: #8aa4c4; font-size: 24rpx; }
.hint-over { color: #90caf9; font-size: 26rpx; }
.cbtn { display:inline-block; margin: 8rpx auto 0; background: transparent; color: #ef9a9a; border: 1rpx solid #ef9a9a; border-radius: 30rpx; font-size: 22rpx; width: 160rpx; }
.log { height: 180rpx; background: #091220; border-radius: 16rpx; padding: 14rpx 18rpx; box-sizing: border-box; }
.log-line { display:block; font-size: 22rpx; color: #aebfdc; line-height: 1.7; }
/* 战斗结束结果面板 */
.result-mask { position: fixed; inset: 0; background: rgba(0,0,0,.72); display: flex; align-items: center; justify-content: center; z-index: 30; }
.result-panel { width: 78%; background: linear-gradient(180deg, #16273d, #0d1825); border: 1rpx solid #2b3d57; border-radius: 24rpx; padding: 36rpx 30rpx; text-align: center; }
.res-emoji { font-size: 88rpx; line-height: 1; }
.res-title { display: block; font-size: 40rpx; font-weight: bold; margin: 14rpx 0 8rpx; letter-spacing: 2rpx; }
.res-title.win { color: #ffd54f; }
.res-title.lose { color: #ef9a9a; }
.res-title.draw { color: #90caf9; }
.res-reason { display: block; font-size: 22rpx; color: #8aa4c4; line-height: 1.6; margin-bottom: 20rpx; }
.res-stat { display: flex; justify-content: space-around; margin-bottom: 26rpx; }
.rs-col { display: flex; flex-direction: column; align-items: center; gap: 6rpx; }
.rs-label { font-size: 20rpx; color: #78909c; }
.rs-val { font-size: 36rpx; font-weight: bold; color: #e8f0ff; }
.rs-val.dead { color: #ef5350; }
.res-again { background: linear-gradient(135deg, #e53935, #b71c1c); color: #fff; font-weight: bold; font-size: 30rpx; letter-spacing: 2rpx; border-radius: 44rpx; padding: 18rpx 0; width: 80%; }
/* 弹窗 */
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 20; }
.spell-panel { width: 82%; background: #fff; color: #263238; border-radius: 22rpx; padding: 30rpx; }
.sp-title { font-size: 30rpx; font-weight: bold; display: block; margin-bottom: 8rpx; }
.sp-mean { background: #f2f7ff; border-radius: 14rpx; padding: 18rpx; margin: 12rpx 0; }
.sp-w { display: block; font-size: 20rpx; color: #999; }
.sp-zh { display: block; font-size: 34rpx; color: #1a73e8; font-weight: bold; margin-top: 6rpx; }
.sp-input { border: 2rpx solid #cfd8e6; border-radius: 14rpx; padding: 16rpx; font-size: 32rpx; }
.sp-btns { display: flex; gap: 18rpx; margin-top: 22rpx; }
.sp-cancel { flex:1; background: #eceff3; color: #666; font-size: 28rpx; border-radius: 40rpx; margin: 0; }
.sp-go { flex:1; background: linear-gradient(90deg,#1a73e8,#00c6ff); color: #fff; font-weight: bold; font-size: 28rpx; border-radius: 40rpx; margin: 0; }
.sp-go[disabled]{ opacity:.5; }
</style>
