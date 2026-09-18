<template>
  <div>
    <h2 class="page-title">单词管理</h2>

    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索单词或释义"
        clearable
        style="width: 200px"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-select v-model="query.bookCode" placeholder="全部词书" clearable style="width: 130px" @change="reload">
        <el-option v-for="b in books" :key="b.book_code" :label="b.book_name" :value="b.book_code" />
      </el-select>
      <el-select v-model="query.order" style="width: 120px" @change="reload">
        <el-option label="ID 正序" value="asc" />
        <el-option label="ID 倒序" value="desc" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <div class="spacer"></div>
      <el-button :icon="Upload" @click="openImport">导入</el-button>
      <el-button :icon="Download" @click="openExport">导出</el-button>
      <el-button type="success" :icon="Plus" @click="openCreate">新增单词</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="word" label="单词" min-width="130">
        <template #default="{ row }">
          <b>{{ row.word }}</b>
        </template>
      </el-table-column>
      <el-table-column prop="phonetic" label="音标" min-width="120" show-overflow-tooltip />
      <el-table-column prop="meaning" label="释义" min-width="180" show-overflow-tooltip />
      <el-table-column prop="pos" label="词性" width="100" show-overflow-tooltip />
      <el-table-column prop="bookName" label="词书" width="80" />
      <el-table-column label="助记" width="80" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.mnemonicCount" size="small" type="warning">🖼 {{ row.mnemonicCount }}</el-tag>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="被收服" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" type="info">{{ row.capturedCount }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="warning" size="small" @click="openMnemonics(row)">助记</el-button>
          <el-button link type="danger" size="small" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="pager"
      layout="total, sizes, prev, pager, next"
      :total="total"
      :page-size="query.pageSize"
      :current-page="query.page"
      :page-sizes="[10, 20, 50, 100]"
      @current-change="onPage"
      @size-change="onSize"
    />

    <!-- 新增/编辑单词 -->
    <el-dialog v-model="dialog.visible" :title="dialog.editing ? '编辑单词' : '新增单词'" width="520px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="词书" required>
          <el-select v-model="form.bookId" placeholder="请选择词书" style="width: 100%">
            <el-option v-for="b in books" :key="b.id" :label="b.book_name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="单词" required>
          <el-input v-model="form.word" placeholder="如 apple" />
        </el-form-item>
        <el-form-item label="音标">
          <el-input v-model="form.phonetic" placeholder="如 /ˈæpl/" />
        </el-form-item>
        <el-form-item label="释义" required>
          <el-input v-model="form.meaning" type="textarea" :rows="2" placeholder="如 苹果" />
        </el-form-item>
        <el-form-item label="词性">
          <el-input v-model="form.pos" placeholder="noun / verb / adjective，可逗号分隔" />
        </el-form-item>
        <el-form-item label="例句">
          <el-input v-model="form.exampleSentence" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 助记管理 -->
    <el-drawer v-model="mn.visible" :title="`助记管理 · ${mn.word}`" size="560px">
      <div v-loading="mn.loading">
        <el-alert type="info" :closable="false" style="margin-bottom: 14px">
          <div style="line-height: 1.7">
            一个单词可以添加多条助记。<br />
            <b>官方助记</b>由后台发布（官方优先展示）；<b>用户助记</b>由小程序用户发布，互相可见。<br />
            用户助记后台不能改内容，只能<b>隐藏/恢复</b>。
          </div>
        </el-alert>

        <el-button type="primary" :icon="Plus" size="small" @click="openMnemonicForm(null)" style="margin-bottom: 14px">
          新增官方助记
        </el-button>

        <el-empty v-if="!mn.list.length && !mn.loading" description="还没有助记" :image-size="70" />

        <div v-for="m in mn.list" :key="m.id" class="mn-card" :class="{ hidden: m.status === 0 }">
          <div class="mn-head">
            <el-tag v-if="m.isOfficial" size="small" type="primary">官方</el-tag>
            <el-tag v-else size="small" type="success">{{ m.authorName || '用户' }}</el-tag>
            <span class="mn-title">{{ m.title || '（无标题）' }}</span>
            <el-tag v-if="m.status === 0" size="small" type="danger">已隐藏</el-tag>
            <span v-if="m.likeCount" class="mn-sort">❤️ {{ m.likeCount }}</span>
            <span class="mn-sort">排序 {{ m.sort }}</span>
            <div class="spacer"></div>
            <el-button v-if="m.isOfficial" link type="primary" size="small" @click="openMnemonicForm(m)">编辑</el-button>
            <el-button
              v-if="!m.isOfficial"
              link
              :type="m.status === 0 ? 'success' : 'warning'"
              size="small"
              @click="toggleMnemonicStatus(m)"
            >{{ m.status === 0 ? '恢复' : '隐藏' }}</el-button>
            <el-button link type="danger" size="small" @click="removeMnemonic(m)">删除</el-button>
          </div>
          <div v-if="m.imageUrl" class="mn-img">
            <el-image :src="absUrl(m.imageUrl)" fit="cover" style="width: 120px; height: 90px" :preview-src-list="[absUrl(m.imageUrl)]" preview-teleported />
          </div>
          <div v-if="m.content" class="mn-content">{{ m.content }}</div>
        </div>
      </div>
    </el-drawer>

    <!-- 助记 新增/编辑（仅官方） -->
    <el-dialog v-model="mnForm.visible" :title="mnForm.editing ? '编辑官方助记' : '新增官方助记'" width="480px" append-to-body>
      <el-form :model="mnForm" label-width="80px">
        <el-form-item label="标题">
          <el-input v-model="mnForm.title" placeholder="如 谐音法 / 图像联想（可留空）" />
        </el-form-item>
        <el-form-item label="图片">
          <el-input v-model="mnForm.imageUrl" placeholder="图片地址 URL（可留空）" />
          <el-image
            v-if="mnForm.imageUrl"
            :src="absUrl(mnForm.imageUrl)"
            fit="cover"
            style="width: 120px; height: 90px; margin-top: 8px"
            :preview-src-list="[absUrl(mnForm.imageUrl)]"
            preview-teleported
          />
        </el-form-item>
        <el-form-item label="助记内容">
          <el-input v-model="mnForm.content" type="textarea" :rows="4" placeholder="助记技巧文字（可留空）" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="mnForm.sort" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mnForm.visible = false">取消</el-button>
        <el-button type="primary" :loading="mnForm.saving" @click="saveMnemonic">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入 -->
    <el-dialog v-model="imp.visible" title="导入单词" width="560px">
      <el-alert type="info" :closable="false" style="margin-bottom: 12px">
        <div style="line-height: 1.7">
          CSV 表头需包含 <b>book_code, word, meaning</b>（必填），
          可选 <b>phonetic, pos, example_sentence</b>。<br />
          第一行必须是表头；支持带逗号/换行的字段（用双引号包裹）。
        </div>
      </el-alert>

      <el-radio-group v-model="imp.mode" style="margin-bottom: 12px">
        <el-radio value="append">追加（重复的单词跳过）</el-radio>
        <el-radio value="upsert">覆盖（同词书重复的单词更新释义）</el-radio>
      </el-radio-group>

      <div class="toolbar" style="margin: 0 0 10px">
        <el-button size="small" :icon="Download" @click="downloadTemplate">下载模板</el-button>
        <el-button size="small" :icon="Upload" @click="pickFile">选择 CSV 文件</el-button>
        <input ref="fileRef" type="file" accept=".csv,text/csv" style="display: none" @change="onFile" />
      </div>

      <el-input
        v-model="imp.csv"
        type="textarea"
        :rows="8"
        placeholder="也可以直接粘贴 CSV 内容…"
      />
      <div class="muted" style="margin-top: 6px">已选文件：{{ imp.filename || '（无）' }}</div>

      <template #footer>
        <el-button @click="imp.visible = false">取消</el-button>
        <el-button type="primary" :loading="imp.loading" @click="doImport">开始导入</el-button>
      </template>
    </el-dialog>

    <!-- 导出 -->
    <el-dialog v-model="exp.visible" title="导出单词" width="460px">
      <el-form label-width="90px">
        <el-form-item label="导出范围">
          <el-radio-group v-model="exp.scope">
            <el-radio value="all">全部单词</el-radio>
            <el-radio value="book">按词书</el-radio>
            <el-radio value="hit">按当前搜索条件</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="exp.scope === 'book'" label="词书">
          <el-select v-model="exp.bookCode" placeholder="选择词书" style="width: 100%">
            <el-option v-for="b in books" :key="b.book_code" :label="b.book_name" :value="b.book_code" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="exp.scope === 'hit'" label="说明">
          <span class="muted">将导出当前筛选结果（{{ total }} 条）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="exp.visible = false">取消</el-button>
        <el-button type="primary" :loading="exp.loading" @click="doExport">下载 CSV</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { Search, Plus, Upload, Download } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { wordApi, downloadCsv } from '../api';

const loading = ref(false);
const saving = ref(false);
const rows = ref([]);
const books = ref([]);
const total = ref(0);
const fileRef = ref(null);

const query = reactive({ page: 1, pageSize: 20, keyword: '', bookCode: '', order: 'asc' });
const dialog = reactive({ visible: false, editing: false, id: null });
const form = reactive({ bookId: null, word: '', phonetic: '', meaning: '', pos: '', exampleSentence: '' });

const mn = reactive({ visible: false, loading: false, wordId: null, word: '', list: [] });
const mnForm = reactive({ visible: false, editing: false, id: null, title: '', imageUrl: '', content: '', sort: 0, saving: false });

const imp = reactive({ visible: false, mode: 'append', csv: '', filename: '', loading: false });
const exp = reactive({ visible: false, scope: 'all', bookCode: '', loading: false });

async function load() {
  loading.value = true;
  try {
    const res = await wordApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword || undefined,
      bookCode: query.bookCode || undefined,
      order: query.order,
    });
    rows.value = res.data.items || [];
    total.value = res.data.total || 0;
  } finally {
    loading.value = false;
  }
}
function reload() { query.page = 1; load(); }
function onPage(p) { query.page = p; load(); }
function onSize(s) { query.pageSize = s; query.page = 1; load(); }

function resetForm() {
  Object.assign(form, { bookId: null, word: '', phonetic: '', meaning: '', pos: '', exampleSentence: '' });
}
function openCreate() {
  resetForm();
  dialog.editing = false;
  dialog.id = null;
  dialog.visible = true;
}
function openEdit(row) {
  dialog.editing = true;
  dialog.id = row.id;
  Object.assign(form, {
    bookId: row.bookId,
    word: row.word,
    phonetic: row.phonetic || '',
    meaning: row.meaning,
    pos: row.pos || '',
    exampleSentence: row.exampleSentence || '',
  });
  dialog.visible = true;
}
async function onSave() {
  if (!form.bookId || !form.word.trim() || !form.meaning.trim()) {
    ElMessage.warning('词书、单词、释义为必填');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      bookId: form.bookId,
      word: form.word,
      phonetic: form.phonetic || null,
      meaning: form.meaning,
      pos: form.pos || null,
      exampleSentence: form.exampleSentence || null,
    };
    if (dialog.editing) {
      await wordApi.update(dialog.id, payload);
      ElMessage.success('已保存');
    } else {
      await wordApi.create(payload);
      ElMessage.success('已新增');
    }
    dialog.visible = false;
    load();
  } finally {
    saving.value = false;
  }
}
async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${row.word}」吗？\n注意：会同时移除 ${row.capturedCount} 张用户已收服的卡牌、${row.mnemonicCount} 条助记，且不可恢复！`,
      '危险操作',
      { type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' }
    );
  } catch { return; }
  const res = await wordApi.remove(row.id);
  ElMessage.success(res.msg || '已删除');
  load();
}

// ===== 助记 =====
async function openMnemonics(row) {
  mn.visible = true;
  mn.wordId = row.id;
  mn.word = row.word;
  await loadMnemonics();
}
async function loadMnemonics() {
  mn.loading = true;
  try {
    const res = await wordApi.mnemonics(mn.wordId);
    mn.list = res.data || [];
  } finally {
    mn.loading = false;
  }
}
function openMnemonicForm(m) {
  if (m) {
    mnForm.editing = true;
    mnForm.id = m.id;
    Object.assign(mnForm, { title: m.title || '', imageUrl: m.imageUrl || '', content: m.content || '', sort: m.sort ?? 0 });
  } else {
    mnForm.editing = false;
    mnForm.id = null;
    Object.assign(mnForm, { title: '', imageUrl: '', content: '', sort: mn.list.length });
  }
  mnForm.visible = true;
}
async function saveMnemonic() {
  if (!mnForm.content.trim() && !mnForm.imageUrl.trim()) {
    ElMessage.warning('助记内容与图片至少填一项');
    return;
  }
  mnForm.saving = true;
  try {
    const payload = {
      title: mnForm.title || null,
      imageUrl: mnForm.imageUrl || null,
      content: mnForm.content || null,
      sort: mnForm.sort,
    };
    if (mnForm.editing) {
      await wordApi.updateMnemonic(mnForm.id, payload);
      ElMessage.success('已保存');
    } else {
      await wordApi.addMnemonic(mn.wordId, payload);
      ElMessage.success('已新增');
    }
    mnForm.visible = false;
    await loadMnemonics();
    load();
  } finally {
    mnForm.saving = false;
  }
}
async function removeMnemonic(m) {
  try {
    await ElMessageBox.confirm('确定删除这条助记吗？删除后不可恢复。', '提示', { type: 'warning' });
  } catch { return; }
  await wordApi.removeMnemonic(m.id);
  ElMessage.success('已删除');
  await loadMnemonics();
  load();
}
async function toggleMnemonicStatus(m) {
  const next = m.status === 0 ? 1 : 0;
  try {
    await ElMessageBox.confirm(
      next === 0 ? '隐藏后用户就看不到这条助记了（不删除，可恢复）。' : '恢复后用户能重新看到这条助记。',
      next === 0 ? '隐藏助记' : '恢复助记',
      { type: 'warning' }
    );
  } catch { return; }
  await wordApi.setMnemonicStatus(m.id, next);
  ElMessage.success(next === 0 ? '已隐藏' : '已恢复');
  await loadMnemonics();
}
// 图片路径：vite 已代理 /uploads 到后端，直接用相对路径即可
function absUrl(url) {
  if (!url) return '';
  const s = String(url);
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  return s.startsWith('/') ? s : '/' + s;
}

// ===== 导入 =====
function openImport() {
  imp.csv = '';
  imp.filename = '';
  imp.visible = true;
}
function pickFile() { fileRef.value?.click(); }
function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  imp.filename = f.name;
  const reader = new FileReader();
  reader.onload = () => { imp.csv = String(reader.result || ''); };
  reader.readAsText(f, 'UTF-8');
  e.target.value = '';
}
async function doImport() {
  if (!imp.csv.trim()) {
    ElMessage.warning('请先选择文件或粘贴 CSV 内容');
    return;
  }
  imp.loading = true;
  try {
    const res = await wordApi.importWords(imp.csv, imp.mode);
    const d = res.data || {};
    imp.visible = false;
    load();
    if (d.errors?.length) {
      await ElMessageBox.alert(
        `<div style="max-height:300px;overflow:auto;line-height:1.7">
          <b>新增 ${d.inserted} 条，更新 ${d.updated} 条，跳过 ${d.skipped} 条</b><hr/>
          ${d.errors.map((e) => `第 ${e.row} 行：${e.reason}`).join('<br/>')}
         </div>`,
        '导入结果（含跳过明细）',
        { dangerouslyUseHTMLString: true, confirmButtonText: '知道了' }
      );
    } else {
      ElMessage.success(`导入完成：新增 ${d.inserted}，更新 ${d.updated}，跳过 ${d.skipped}`);
    }
  } finally {
    imp.loading = false;
  }
}
function downloadTemplate() {
  downloadCsv('/admin/words/import-template', 'words_template.csv');
}

// ===== 导出 =====
function openExport() {
  exp.scope = 'all';
  exp.bookCode = '';
  exp.visible = true;
}
async function doExport() {
  exp.loading = true;
  try {
    const params = new URLSearchParams();
    let suffix = 'all';
    if (exp.scope === 'book' && exp.bookCode) {
      params.set('bookCode', exp.bookCode);
      suffix = exp.bookCode;
    } else if (exp.scope === 'hit') {
      if (query.keyword) params.set('keyword', query.keyword);
      // 按当前搜索条件导出：先拿到全部匹配 id
      const res = await wordApi.list({ page: 1, pageSize: 200, keyword: query.keyword || undefined, bookCode: query.bookCode || undefined, order: query.order });
      const ids = (res.data.items || []).map((x) => x.id);
      if (!ids.length) {
        ElMessage.warning('当前筛选没有可导出的单词');
        return;
      }
      params.set('ids', ids.join(','));
      suffix = 'filtered';
    }
    const stamp = new Date().toISOString().slice(0, 10);
    await downloadCsv(`/admin/words/export?${params.toString()}`, `words_${suffix}_${stamp}.csv`);
    exp.visible = false;
    ElMessage.success('已开始下载');
  } finally {
    exp.loading = false;
  }
}

onMounted(async () => {
  const b = await wordApi.books();
  books.value = b.data || [];
  load();
});
</script>

<style scoped>
.pager { margin-top: 16px; justify-content: flex-end; }
.mn-card {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #fafafa;
}
.mn-card.hidden { opacity: 0.55; background: #f4f4f5; }
.mn-head { display: flex; align-items: center; gap: 8px; }
.mn-title { font-weight: 600; }
.mn-sort { color: #909399; font-size: 12px; }
.mn-img { margin-top: 8px; }
.mn-content {
  margin-top: 8px;
  white-space: pre-wrap;
  line-height: 1.6;
  color: #303133;
  font-size: 14px;
}
</style>
