<template>
  <div>
    <h2 class="page-title">单词管理</h2>

    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索单词或释义"
        clearable
        style="width: 220px"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-select v-model="query.bookCode" placeholder="全部词书" clearable style="width: 140px" @change="reload">
        <el-option v-for="b in books" :key="b.book_code" :label="b.book_name" :value="b.book_code" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <div class="spacer"></div>
      <el-button type="success" :icon="Plus" @click="openCreate">新增单词</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" border stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="word" label="单词" min-width="140">
        <template #default="{ row }">
          <b>{{ row.word }}</b>
        </template>
      </el-table-column>
      <el-table-column prop="phonetic" label="音标" min-width="130" show-overflow-tooltip />
      <el-table-column prop="meaning" label="释义" min-width="200" show-overflow-tooltip />
      <el-table-column prop="pos" label="词性" width="110" show-overflow-tooltip />
      <el-table-column prop="bookName" label="词书" width="90" />
      <el-table-column label="被收服" width="90" align="center">
        <template #default="{ row }">
          <el-tag size="small" type="info">{{ row.capturedCount }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
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
          <el-input v-model="form.pos" placeholder="noun / verb / adjective / adverb，可逗号分隔" />
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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { Search, Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { wordApi } from '../api';

const loading = ref(false);
const saving = ref(false);
const rows = ref([]);
const books = ref([]);
const total = ref(0);

const query = reactive({ page: 1, pageSize: 20, keyword: '', bookCode: '' });
const dialog = reactive({ visible: false, editing: false, id: null });
const form = reactive({
  bookId: null,
  word: '',
  phonetic: '',
  meaning: '',
  pos: '',
  exampleSentence: '',
});

async function load() {
  loading.value = true;
  try {
    const res = await wordApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword || undefined,
      bookCode: query.bookCode || undefined,
    });
    rows.value = res.data.items || [];
    total.value = res.data.total || 0;
  } finally {
    loading.value = false;
  }
}

function reload() {
  query.page = 1;
  load();
}
function onPage(p) {
  query.page = p;
  load();
}
function onSize(s) {
  query.pageSize = s;
  query.page = 1;
  load();
}

function resetForm() {
  form.bookId = null;
  form.word = '';
  form.phonetic = '';
  form.meaning = '';
  form.pos = '';
  form.exampleSentence = '';
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
  form.bookId = row.bookId;
  form.word = row.word;
  form.phonetic = row.phonetic || '';
  form.meaning = row.meaning;
  form.pos = row.pos || '';
  form.exampleSentence = row.exampleSentence || '';
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
      `确定删除「${row.word}」吗？\n注意：会同时移除 ${row.capturedCount} 张用户已收服的卡牌，且不可恢复！`,
      '危险操作',
      { type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' }
    );
  } catch {
    return;
  }
  const res = await wordApi.remove(row.id);
  ElMessage.success(res.msg || '已删除');
  load();
}

onMounted(async () => {
  const b = await wordApi.books();
  books.value = b.data || [];
  load();
});
</script>

<style scoped>
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
