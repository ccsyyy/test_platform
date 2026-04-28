const state = {
  token: localStorage.getItem("tp_token") || "",
  user: null,
  projects: [],
  environments: [],
  selectedProjectId: Number(localStorage.getItem("tp_project_id") || 0),
  selectedEnvironmentId: 0,
  activeView: localStorage.getItem("tp_active_view") || "overview",
  recordings: [],
  recordingPage: 1,
  recordingPageSize: 10,
  recordingTotal: 0,
  recordingTotalPages: 1,
  cases: [],
  casePage: 1,
  casePageSize: 10,
  caseGroups: [],
  currentCaseId: 0,
  currentCaseElements: [],
  caseSaving: false,
  elementPickerStepId: 0,
  elementPickerKeyword: "",
  elementPickerPageId: "",
  elementPickerComponentId: "",
  elementPickerElements: [],
  selectedExecutionCaseIds: [],
  executionCaseModuleFilter: "",
  jobs: [],
  jobPage: 1,
  jobPageSize: 10,
  elements: [],
  elementPage: 1,
  elementPageSize: 10,
  elementTree: [],
  selectedElementPageId: localStorage.getItem("tp_element_page_id") || "all",
  currentElementId: 0,
  currentElementMode: "edit",
  members: [],
  memberPage: 1,
  memberPageSize: 10,
  users: [],
  projectPage: 1,
  projectPageSize: 8,
  environmentPage: 1,
  environmentPageSize: 8,
  reportPage: 1,
  reportPageSize: 10,
  agentStatus: "未检测",
  activeRecordingSession: localStorage.getItem("tp_active_recording") || "",
  recordingEventSession: "",
  recordingEventPage: 1,
  recordingEventPageSize: 10,
  currentModal: "",
  environmentBaseUrlMap: {},
  elementTreeOpenPages: new Set(),
  elementTreeOpenComponents: new Set(),
  sidebarCollapsed: localStorage.getItem("tp_sidebar_collapsed") === "1",
  elementTreeCollapsed: localStorage.getItem("tp_element_tree_collapsed") === "1",
  settingsTab: localStorage.getItem("tp_settings_tab") || "projects",
  projectSettings: null,
  projectAiConfig: null,
  aiHealLogs: [],
  aiHealLogPage: 1,
  aiHealLogPageSize: 10,
  aiHealLogTotal: 0,
  aiHealLogTotalPages: 1,
  environmentManageProjectId: 0,
  environmentManageProjectName: "",
  environmentManageItems: [],
  environmentEditingId: 0,
  projectEditingId: 0,
  moduleManageProjectId: 0,
  moduleManageProjectName: "",
  moduleManageItems: [],
  moduleEditingId: 0,
  treeNodeEditType: "",
  treeNodeEditId: "",
  treeNodeEditName: "",
  treeNodeEditPageId: "",
  treeNodeEditVirtual: false
};

const $ = (id) => document.getElementById(id);

function defaultProjectSettings() {
  return {
    execution: {
      defaultBrowser: "chrome",
      defaultHeadless: true,
      defaultRetries: 0,
      defaultTimeoutMs: 30000,
      defaultScreenshot: true,
      defaultVideo: true,
      defaultTrace: false,
      reportRetentionDays: 30,
      logRetentionDays: 7
    },
    agent: {
      baseUrl: "http://127.0.0.1:37665",
      healthPath: "/health",
      checkBeforeRecording: true,
      autoCheckOnLoad: true
    }
  };
}

function normalizeProjectSettings(value) {
  const defaults = defaultProjectSettings();
  const execution = value?.execution || {};
  const agent = value?.agent || {};
  const healthPath = String(agent.healthPath || defaults.agent.healthPath).trim() || defaults.agent.healthPath;
  return {
    execution: {
      defaultBrowser: ["chromium", "chrome", "edge"].includes(execution.defaultBrowser)
        ? execution.defaultBrowser
        : defaults.execution.defaultBrowser,
      defaultHeadless: execution.defaultHeadless ?? defaults.execution.defaultHeadless,
      defaultRetries: Number.isFinite(Number(execution.defaultRetries))
        ? Math.max(0, Math.min(5, Number(execution.defaultRetries)))
        : defaults.execution.defaultRetries,
      defaultTimeoutMs: Number.isFinite(Number(execution.defaultTimeoutMs))
        ? Math.max(1000, Math.min(300000, Number(execution.defaultTimeoutMs)))
        : defaults.execution.defaultTimeoutMs,
      defaultScreenshot: execution.defaultScreenshot ?? defaults.execution.defaultScreenshot,
      defaultVideo: execution.defaultVideo ?? defaults.execution.defaultVideo,
      defaultTrace: execution.defaultTrace ?? defaults.execution.defaultTrace,
      reportRetentionDays: Number.isFinite(Number(execution.reportRetentionDays))
        ? Math.max(1, Math.min(3650, Number(execution.reportRetentionDays)))
        : defaults.execution.reportRetentionDays,
      logRetentionDays: Number.isFinite(Number(execution.logRetentionDays))
        ? Math.max(1, Math.min(3650, Number(execution.logRetentionDays)))
        : defaults.execution.logRetentionDays
    },
    agent: {
      baseUrl: String(agent.baseUrl || defaults.agent.baseUrl).trim().replace(/\/+$/, "") || defaults.agent.baseUrl,
      healthPath: healthPath.startsWith("/") ? healthPath : `/${healthPath}`,
      checkBeforeRecording: agent.checkBeforeRecording ?? defaults.agent.checkBeforeRecording,
      autoCheckOnLoad: agent.autoCheckOnLoad ?? defaults.agent.autoCheckOnLoad
    }
  };
}

function currentProjectSettings() {
  return normalizeProjectSettings(state.projectSettings);
}

function syncProjectSettingsToInputs() {
  const settings = currentProjectSettings();
  if ($("agent-url")) {
    $("agent-url").value = settings.agent.baseUrl;
  }
}

const roleNames = {
  project_admin: "项目管理员",
  test_lead: "测试负责人",
  tester: "测试人员",
  viewer: "只读成员",
  admin: "管理员"
};

const statusLabels = {
  created: "已创建",
  recording: "录制中",
  stopped: "已停止",
  materialized: "已生成",
  failed: "失败",
  queued: "排队中",
  running: "执行中",
  passed: "执行通过",
  canceled: "已取消",
  timeout: "超时",
  generated: "已生成",
  verified: "已验证",
  applied: "已应用",
  skipped: "已跳过",
  rejected: "已拒绝",
  rejected_by_confidence: "置信度不足",
  visual_failed: "视觉定位失败",
  active: "启用",
  disabled: "禁用",
  removed: "已移除",
  valid: "有效",
  invalid: "无效",
  unknown: "未验证"
};

const environmentTypeLabels = {
  local: "本地",
  test: "测试",
  staging: "预发",
  prod: "生产"
};

const elementLocatorTypeOptions = [
  { value: "testId", label: "testId" },
  { value: "role", label: "role" },
  { value: "label", label: "label" },
  { value: "placeholder", label: "placeholder" },
  { value: "text", label: "text" },
  { value: "css", label: "css" },
  { value: "compactCss", label: "compactCss" },
  { value: "relativeXPath", label: "relativeXPath" },
  { value: "xpath", label: "xpath" }
];

function normalizeElementLocatorType(locatorType = "") {
  const value = String(locatorType || "").trim().toLowerCase();
  if (value === "compactcss" || value === "compact_css") {
    return "compactcss";
  }
  if (value === "relativexpath" || value === "relative_xpath") {
    return "relativexpath";
  }
  if (value === "test-id" || value === "test_id") {
    return "testid";
  }
  return value;
}

function parseRoleLocatorValue(locatorValue) {
  try {
    const parsed = JSON.parse(locatorValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const role = typeof parsed.role === "string" ? parsed.role.trim() : "";
    if (!role) {
      return null;
    }
    const options = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (key === "role" || value === null || value === undefined) {
        return;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          options[key] = trimmed;
        }
        return;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        options[key] = value;
      }
    });
    return { role, options };
  } catch {
    return null;
  }
}

function buildElementLocatorExpression(locatorType, locatorValue) {
  const type = normalizeElementLocatorType(locatorType);
  const value = String(locatorValue || "").trim();
  if (!type || !value) {
    return "";
  }
  if (type === "testid" || type === "get_by_test_id" || type === "getbytestid") {
    return `page.getByTestId(${JSON.stringify(value)})`;
  }
  if (type === "role" || type === "get_by_role" || type === "getbyrole") {
    const roleLocator = parseRoleLocatorValue(value);
    if (roleLocator?.role) {
      const hasOptions = Object.keys(roleLocator.options).length > 0;
      return hasOptions
        ? `page.getByRole(${JSON.stringify(roleLocator.role)}, ${JSON.stringify(roleLocator.options)})`
        : `page.getByRole(${JSON.stringify(roleLocator.role)})`;
    }
    return `page.getByRole(${JSON.stringify(value)})`;
  }
  if (type === "label") {
    return `page.getByLabel(${JSON.stringify(value)})`;
  }
  if (type === "placeholder") {
    return `page.getByPlaceholder(${JSON.stringify(value)})`;
  }
  if (type === "text" || type === "get_by_text" || type === "getbytext") {
    return `page.getByText(${JSON.stringify(value)})`;
  }
  if (type === "xpath" || type === "relativexpath") {
    return `page.locator(${JSON.stringify(`xpath=${value}`)})`;
  }
  return `page.locator(${JSON.stringify(value)})`;
}

function syncLocatorExpressionInput(input, locatorType, locatorValue) {
  const locatorExpression = buildElementLocatorExpression(locatorType, locatorValue);
  if (input instanceof HTMLInputElement) {
    input.value = locatorExpression;
  }
  return locatorExpression;
}

function syncLocatorFormExpression() {
  return syncLocatorExpressionInput(
    $("locator-form-expression"),
    $("locator-form-type")?.value || "",
    $("locator-form-value")?.value || ""
  );
}

function syncElementLocatorRowExpression(row) {
  if (!(row instanceof HTMLElement)) {
    return "";
  }
  return syncLocatorExpressionInput(
    row.querySelector('[data-field="locatorExpression"]'),
    row.querySelector('[data-field="locatorType"]')?.value || "",
    row.querySelector('[data-field="locatorValue"]')?.value || ""
  );
}

const viewNames = new Set(["overview", "recordings", "elements", "cases", "tasks", "reports", "members", "settings"]);

function setText(id, value) {
  const element = $(id);
  if (element) {
    element.textContent = value;
  }
}

function applySidebarState() {
  $("dashboard-view")?.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  setText("sidebar-toggle", state.sidebarCollapsed ? ">" : "<");
}

function applyElementTreeState() {
  document.querySelector(".element-workspace")?.classList.toggle("tree-collapsed", state.elementTreeCollapsed);
  setText("element-tree-toggle", state.elementTreeCollapsed ? ">" : "<");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function authHeaders(headers = {}) {
  return {
    ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    ...(headers || {})
  };
}

async function readResponseError(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      if (payload?.message) {
        return payload.message;
      }
    } catch {}
  }
  const text = await response.text().catch(() => "");
  return text || `请求失败 (${response.status})`;
}

async function api(path, options = {}) {
  const headers = authHeaders(options.headers);
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(hasContentType ? {} : { "content-type": "application/json" }),
      ...headers
    }
  });
  const payload = await response.json();
  if (!response.ok || payload.code >= 400) {
    throw new Error(payload.message || "请求失败");
  }
  return payload.data;
}

function triggerBlobDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "artifact";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function accessArtifact(artifactId, fileName, mode = "download") {
  const query = new URLSearchParams({ mode }).toString();
  const response = await fetch(`/api/artifacts/${artifactId}/content?${query}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  if (mode === "inline") {
    const previewWindow = window.open(url, "_blank");
    if (!previewWindow) {
      triggerBlobDownload(url, fileName);
      return;
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    return;
  }
  triggerBlobDownload(url, fileName);
}

function showLogin(message = "") {
  $("login-view").classList.remove("hidden");
  $("dashboard-view").classList.add("hidden");
  setText("login-message", message);
}

function showDashboard() {
  $("login-view").classList.add("hidden");
  $("dashboard-view").classList.remove("hidden");
  applySidebarState();
  applyElementTreeState();
}

function statusLabel(status) {
  return statusLabels[String(status || "unknown")] || String(status || "未知");
}

function badge(status) {
  const rawStatus = String(status || "unknown");
  const safeStatus = escapeHtml(rawStatus);
  return `<span class="badge ${safeStatus}">${escapeHtml(statusLabel(rawStatus))}</span>`;
}

function fmt(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 19);
}

function fmtDuration(value) {
  const ms = Number(value || 0);
  if (!ms) return "-";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

function calcPassRate(job) {
  const total = Number(job.totalCases || 0);
  if (!total) return 0;
  return Math.round((Number(job.passedCases || 0) / total) * 100);
}

function reportJobs() {
  return state.jobs.filter((job) => job.finishedAt || ["passed", "failed", "canceled", "timeout"].includes(job.status));
}

function selectedProject() {
  return state.projects.find((project) => Number(project.id) === Number(state.selectedProjectId)) || null;
}

function selectedEnvironment() {
  return state.environments.find((environment) => Number(environment.id) === Number(state.selectedEnvironmentId)) || null;
}

function canManageMembers() {
  const project = selectedProject();
  return state.user?.roleCode === "admin" || project?.projectRole === "project_admin";
}

function canManageSettings() {
  const project = selectedProject();
  return state.user?.roleCode === "admin" || project?.projectRole === "project_admin";
}

function canCreateProject() {
  return ["admin", "test_lead"].includes(state.user?.roleCode || "");
}

function agentBaseUrl() {
  return ($("agent-url")?.value || currentProjectSettings().agent.baseUrl || "").trim().replace(/\/+$/, "");
}

function agentHealthPath() {
  const healthPath = String(currentProjectSettings().agent.healthPath || "/health").trim() || "/health";
  return healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
}

function paginate(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages
  };
}

function renderPagination({ key, page, total, totalPages }) {
  return `<div class="pagination">
    <span>共 ${total} 条，第 ${page} / ${totalPages} 页</span>
    <button class="secondary" data-action="paginate" data-key="${key}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
    <button class="secondary" data-action="paginate" data-key="${key}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
  </div>`;
}

function setPageState(key, page) {
  const field = `${key}Page`;
  if (Object.prototype.hasOwnProperty.call(state, field)) {
    state[field] = Math.max(1, Number(page) || 1);
  }
}

function resetListPages() {
  state.recordingPage = 1;
  state.casePage = 1;
  state.jobPage = 1;
  state.elementPage = 1;
  state.memberPage = 1;
  state.projectPage = 1;
  state.environmentPage = 1;
  state.reportPage = 1;
  state.aiHealLogPage = 1;
  state.selectedExecutionCaseIds = [];
  state.executionCaseModuleFilter = "";
}

function renderActionMenu({ detail, more = [] }) {
  const detailButton = detail
    ? `<button class="small secondary" ${detail.disabled ? "disabled" : ""} data-action="${detail.action}" ${detail.attrs || ""}>${detail.label}</button>`
    : "";
  const visibleMore = more.filter(Boolean);
  if (!visibleMore.length) {
    return `<div class="table-actions">${detailButton}</div>`;
  }
  const menuItems = visibleMore
    .map(
      (item) =>
        `<button class="menu-item ${item.variant === "danger" ? "danger" : ""}" ${item.disabled ? "disabled" : ""} data-action="${item.action}" ${item.attrs || ""}>${item.label}</button>`
    )
    .join("");
  return `<div class="table-actions">
    ${detailButton}
    <details class="action-menu">
      <summary class="small secondary">更多</summary>
      <div class="action-menu-list">${menuItems}</div>
    </details>
  </div>`;
}

function closeAllActionMenus(exceptMenu = null) {
  document.querySelectorAll(".action-menu[open]").forEach((menu) => {
    if (menu !== exceptMenu) {
      menu.open = false;
    }
  });
}

function positionActionMenu(menu) {
  if (!(menu instanceof HTMLElement) || !menu.open) return;
  const summary = menu.querySelector("summary");
  const list = menu.querySelector(".action-menu-list");
  if (!(summary instanceof HTMLElement) || !(list instanceof HTMLElement)) return;
  const rect = summary.getBoundingClientRect();
  const width = Math.max(128, list.offsetWidth || 128);
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));
  const top = Math.min(window.innerHeight - 8, rect.bottom + 6);
  menu.style.setProperty("--menu-left", `${left}px`);
  menu.style.setProperty("--menu-top", `${top}px`);
}

function positionOpenActionMenus() {
  document.querySelectorAll(".action-menu[open]").forEach((menu) => positionActionMenu(menu));
}

function renderPagedTable({ key, page, total, totalPages, tableHtml }) {
  return `<div class="list-pane">
    <div class="table-wrap list-scroll">${tableHtml}</div>
    ${renderPagination({ key, page, total, totalPages })}
  </div>`;
}

function refreshTableCellTitles(root = document) {
  root.querySelectorAll(".data-table [title]").forEach((node) => {
    if (node instanceof HTMLElement) {
      node.removeAttribute("title");
    }
  });
  root.querySelectorAll(".data-table th, .data-table td").forEach((cell) => {
    if (!(cell instanceof HTMLElement)) return;
    cell.removeAttribute("title");
  });
}

function cellTooltipText(cell) {
  const formControl = cell.querySelector("input:not([type='hidden']), select, textarea");
  if (formControl instanceof HTMLSelectElement) {
    return formControl.selectedOptions[0]?.textContent?.trim() || "";
  }
  if (formControl instanceof HTMLInputElement || formControl instanceof HTMLTextAreaElement) {
    return formControl.value?.trim() || "";
  }
  return cell.textContent?.replace(/\s+/g, " ").trim() || "";
}

function ensureCellTooltip() {
  let tooltip = $("cell-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "cell-tooltip";
    tooltip.className = "cell-tooltip";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function moveCellTooltip(event) {
  const tooltip = $("cell-tooltip");
  if (!tooltip || tooltip.style.display !== "block") return;
  const padding = 12;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + 12;
  let top = event.clientY + 14;
  if (left + rect.width + padding > window.innerWidth) {
    left = Math.max(padding, window.innerWidth - rect.width - padding);
  }
  if (top + rect.height + padding > window.innerHeight) {
    top = Math.max(padding, event.clientY - rect.height - 12);
  }
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showCellTooltip(cell, event) {
  const text = cellTooltipText(cell);
  if (!text || cell.querySelector(".table-actions, button, a")) {
    hideCellTooltip();
    return;
  }
  const tooltip = ensureCellTooltip();
  tooltip.textContent = text;
  tooltip.style.display = "block";
  moveCellTooltip(event);
}

function hideCellTooltip() {
  const tooltip = $("cell-tooltip");
  if (tooltip) {
    tooltip.style.display = "none";
  }
}

ensureElementToolbarLayout();
ensureLocatorFormModal();

function openModal(id) {
  if (state.currentModal === id) {
    $(id)?.classList.remove("hidden");
    return;
  }
  closeCurrentModal();
  $(id)?.classList.remove("hidden");
  state.currentModal = id;
}

function closeModal(id) {
  $(id)?.classList.add("hidden");
  if (state.currentModal === id) {
    state.currentModal = "";
  }
}

function closeCurrentModal() {
  if (state.currentModal) {
    const current = state.currentModal;
    state.currentModal = "";
    closeModalView(current);
  }
}

function closeModalView(id) {
  if (id === "app-notice-modal") return closeNotice();
  if (id === "app-confirm-modal") return closeConfirm(false);
  if (id === "recording-event-modal") return closeRecordingEvents();
  if (id === "materialize-notice-modal") return closeMaterializeNotice();
  if (id === "element-detail-modal") return closeElementDetail();
  if (id === "locator-form-modal") return closeLocatorFormModal();
  if (id === "tree-node-modal") return closeTreeNodeModal();
  if (id === "case-detail-modal") return closeCaseDetail();
  if (id === "element-picker-modal") return closeElementPickerModal();
  if (id === "job-detail-modal") return closeJobDetail();
  if (id === "environment-form-modal") return closeEnvironmentFormModal();
  if (id === "module-form-modal") return closeModuleFormModal();
  if (id === "module-manage-modal") {
    state.moduleManageProjectId = 0;
    state.moduleManageProjectName = "";
    state.moduleManageItems = [];
    return closeModal(id);
  }
  closeModal(id);
}

let confirmResolver = null;

function showNotice(title, message = "", summary = "") {
  const normalizedTitle = title && !message && /^请/.test(title) ? "操作提示" : title || "操作提示";
  const normalizedMessage = title && !message && /^请/.test(title) ? title : message;
  setText("app-notice-title", normalizedTitle);
  setText("app-notice-summary", summary);
  setText("app-notice-message", normalizedMessage);
  $("app-notice-modal")?.classList.remove("hidden");
  state.currentModal = "app-notice-modal";
}

function closeNotice() {
  closeModal("app-notice-modal");
  setText("app-notice-summary", "");
  setText("app-notice-message", "");
}

function confirmAction({ title = "确认操作", message = "", summary = "", confirmText = "确认" } = {}) {
  setText("app-confirm-title", title);
  setText("app-confirm-summary", summary);
  setText("app-confirm-message", message);
  setText("app-confirm-ok", confirmText);
  $("app-confirm-modal")?.classList.remove("hidden");
  state.currentModal = "app-confirm-modal";
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  closeModal("app-confirm-modal");
  const resolver = confirmResolver;
  confirmResolver = null;
  if (resolver) {
    resolver(Boolean(result));
  }
}

function syncRecordingUrlWithEnvironment(force = false) {
  const input = $("recording-url");
  if (!input) return;
  const environment = selectedEnvironment();
  const baseUrl = environment?.baseUrl?.trim() || "";
  const currentValue = input.value.trim();
  const previousBaseUrl = state.environmentBaseUrlMap[state.selectedEnvironmentId] || "";
  if (force || !currentValue || currentValue === previousBaseUrl) {
    input.value = baseUrl;
  }
  if (baseUrl) {
    state.environmentBaseUrlMap[state.selectedEnvironmentId] = baseUrl;
  }
}

function setAgentMessage(message) {
  setText("agent-message", message);
}

function setAgentStatus(message) {
  state.agentStatus = message;
  const status = $("agent-status");
  if (status) status.textContent = message;
}

function setMemberMessage(message) {
  setText("member-message", message);
}

async function login() {
  setText("login-message", "");
  const username = $("username").value.trim();
  const password = $("password").value;
  const data = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem("tp_token", state.token);
  showDashboard();
  await loadAll();
}

async function loadAll() {
  if (!state.user) {
    state.user = await api("/api/auth/me");
  }
  state.projects = await api("/api/projects");
  if (!state.projects.length) {
    renderEmptyConsole();
    return;
  }
  if (!state.selectedProjectId || !state.projects.some((project) => Number(project.id) === Number(state.selectedProjectId))) {
    state.selectedProjectId = Number(state.projects[0].id);
  }
  localStorage.setItem("tp_project_id", String(state.selectedProjectId));
  renderProjects();
  await loadProjectData();
}

async function loadProjectData() {
  state.projectSettings = defaultProjectSettings();
  syncProjectSettingsToInputs();
  await Promise.all([
    loadEnvironments(),
    loadRecordings(),
    loadElements(),
    loadCases(),
    loadJobs(),
    loadMembers(),
    loadUsers(),
    loadProjectSettings().catch(() => {}),
    loadProjectAiConfig().catch(() => {}),
    loadAiHealLogs().catch(() => {})
  ]);
  renderShell();
  syncRecordingButtons();
  switchView(state.activeView);
  if (currentProjectSettings().agent.autoCheckOnLoad !== false) {
    checkAgent(true).catch(() => {});
  }
}

async function loadProjectSettings() {
  if (!state.selectedProjectId) return;
  state.projectSettings = normalizeProjectSettings(
    await api(`/api/projects/${state.selectedProjectId}/settings`)
  );
  syncProjectSettingsToInputs();
}

async function loadProjectAiConfig() {
  if (!state.selectedProjectId) return;
  state.projectAiConfig = await api(`/api/projects/${state.selectedProjectId}/ai-config`);
}

async function loadAiHealLogs() {
  if (!state.selectedProjectId) return;
  const status = $("ai-heal-status")?.value || "";
  const keyword = $("ai-heal-keyword")?.value?.trim() || "";
  const params = new URLSearchParams({
    projectId: String(state.selectedProjectId),
    page: String(state.aiHealLogPage),
    pageSize: String(state.aiHealLogPageSize)
  });
  if (status) params.set("status", status);
  if (keyword) params.set("keyword", keyword);
  const data = await api(`/api/locator-heal-logs?${params.toString()}`);
  state.aiHealLogs = data.items || [];
  state.aiHealLogPage = data.page || 1;
  state.aiHealLogTotal = data.total || 0;
  state.aiHealLogTotalPages = data.totalPages || 1;
}

function renderEmptyConsole() {
  setText("current-user", state.user?.username || "-");
  $("project-select").innerHTML = "";
  $("environment-select").innerHTML = "";
  setText("recording-meta", "暂无录制");
  setText("element-meta", "暂无元素");
  setText("case-meta", "暂无用例");
  setText("job-meta", "暂无任务");
  setText("report-meta", "暂无报告");
}

function renderShell() {
  const latestJob = state.jobs[0];
  const latestRecording = state.recordings[0];
  const latestCase = state.cases[0];
  const latestReport = reportJobs()[0];
  const invalidCount = state.elements.filter((item) => Number(item.validStatus) === 0).length;
  setText("current-user", state.user?.username || "-");
  setAgentStatus(state.agentStatus);
  setText("recording-count", String(state.recordingTotal || state.recordings.length));
  setText("element-count", String(state.elements.length));
  setText("case-count", String(state.cases.length));
  setText("job-count", String(state.jobs.length));
  setText("report-count", String(reportJobs().length));
  setText("recording-meta", latestRecording ? `${statusLabel(latestRecording.status)} / ${fmt(latestRecording.createdAt)}` : "暂无录制");
  setText("element-meta", invalidCount ? `${invalidCount} 个待校验` : "当前均为正常状态");
  setText("case-meta", latestCase ? `${latestCase.stepCount || 0} 步 / ${fmt(latestCase.createdAt)}` : "暂无用例");
  setText("job-meta", latestJob ? `${statusLabel(latestJob.status)} / ${calcPassRate(latestJob)}%` : "暂无任务");
  setText("report-meta", latestReport ? `${statusLabel(latestReport.status)} / ${fmt(latestReport.finishedAt || latestReport.updatedAt)}` : "暂无报告");
  renderOverview();
  renderReports();
  renderSettings();
  applySidebarState();
  applyElementTreeState();
  refreshTableCellTitles();
}

function renderProjects() {
  $("project-select").innerHTML = state.projects
    .map(
      (project) =>
        `<option value="${project.id}" ${Number(project.id) === Number(state.selectedProjectId) ? "selected" : ""}>${escapeHtml(project.projectName)}</option>`
    )
    .join("");
}

async function loadEnvironments() {
  const previousEnvironmentId = state.selectedEnvironmentId;
  state.environments = await api(`/api/projects/${state.selectedProjectId}/environments`);
  if (
    state.selectedEnvironmentId &&
    !state.environments.some((environment) => Number(environment.id) === Number(state.selectedEnvironmentId))
  ) {
    state.selectedEnvironmentId = 0;
  }
  if (!state.selectedEnvironmentId && state.environments.length) {
    state.selectedEnvironmentId = Number(state.environments[0].id);
  }
  $("environment-select").innerHTML = state.environments.length
    ? state.environments
        .map(
          (environment) =>
            `<option value="${environment.id}" ${Number(environment.id) === Number(state.selectedEnvironmentId) ? "selected" : ""}>${escapeHtml(environment.envName)}</option>`
        )
        .join("")
    : `<option value="">暂无环境</option>`;
  renderExecutionEnvironmentOptions();
  syncRecordingUrlWithEnvironment(Number(state.selectedEnvironmentId) !== Number(previousEnvironmentId));
}

async function loadRecordings() {
  const query = new URLSearchParams({ projectId: String(state.selectedProjectId) });
  const status = $("recording-status-filter")?.value || "";
  if (status) query.set("status", status);
  query.set("page", String(state.recordingPage));
  query.set("pageSize", String(state.recordingPageSize));
  const data = await api(`/api/recording-sessions?${query.toString()}`);
  state.recordings = data.items || [];
  state.recordingPage = data.page || 1;
  state.recordingPageSize = data.pageSize || state.recordingPageSize;
  state.recordingTotal = data.total || 0;
  state.recordingTotalPages = data.totalPages || 1;
  $("recording-list").innerHTML = state.recordings.length
    ? renderRecordingTable(state.recordings)
    : `<div class="empty-state">暂无录制会话。</div>${renderRecordingPagination()}`;
}

async function loadElements() {
  const keyword = $("element-keyword")?.value?.trim() || "";
  const query = new URLSearchParams({ projectId: String(state.selectedProjectId) });
  if (keyword) query.set("keyword", keyword);
  const validStatus = $("element-valid-filter")?.value || "";
  if (state.selectedElementPageId !== "all") query.set("pageId", state.selectedElementPageId);
  if (validStatus) query.set("validStatus", validStatus);
  const [tree, elements] = await Promise.all([
    api(`/api/elements/tree?projectId=${state.selectedProjectId}`),
    api(`/api/elements?${query.toString()}`)
  ]);
  state.elementTree = tree;
  state.elements = elements;
  const pagination = paginate(state.elements, state.elementPage, state.elementPageSize);
  state.elementPage = pagination.page;
  $("element-tree").innerHTML = renderElementTree();
  $("element-library").innerHTML = state.elements.length
    ? renderPagedTable({
        key: "element",
        page: pagination.page,
        total: pagination.total,
        totalPages: pagination.totalPages,
        tableHtml: renderElementTable(pagination.items)
      })
    : `<div class="empty-state">暂无元素。生成用例后将自动沉淀元素，也可新增元素。</div>`;
}

async function loadCases() {
  const keyword = $("case-keyword")?.value?.trim() || "";
  const groupId = $("case-group-filter")?.value || "";
  const query = new URLSearchParams({ projectId: String(state.selectedProjectId) });
  if (keyword) query.set("keyword", keyword);
  if (groupId) query.set("groupId", groupId);
  const [groups, cases] = await Promise.all([
    api(`/api/case-groups?projectId=${state.selectedProjectId}`),
    api(`/api/test-cases?${query.toString()}`)
  ]);
  state.caseGroups = groups;
  state.cases = cases;
  const pagination = paginate(state.cases, state.casePage, state.casePageSize);
  state.casePage = pagination.page;
  renderCaseGroupFilter();
  renderExecutionCaseOptions();
  $("case-list").innerHTML = state.cases.length
    ? renderPagedTable({
        key: "case",
        page: pagination.page,
        total: pagination.total,
        totalPages: pagination.totalPages,
        tableHtml: renderCaseTable(pagination.items)
      })
    : `<div class="empty-state">暂无用例。</div>`;
}

function renderCaseGroupFilter() {
  const current = $("case-group-filter")?.value || "";
  $("case-group-filter").innerHTML =
    `<option value="">全部分组</option>` +
    state.caseGroups
      .map(
        (group) =>
          `<option value="${group.id}" ${String(group.id) === current ? "selected" : ""}>${escapeHtml(group.groupName)}</option>`
      )
      .join("");
}

function renderExecutionEnvironmentOptions() {
  const select = $("execution-environment-select");
  if (!select) return;
  const current = select.value || String(state.selectedEnvironmentId || "");
  select.innerHTML = state.environments.length
    ? state.environments
        .map(
          (environment) =>
            `<option value="${environment.id}" ${String(environment.id) === current ? "selected" : ""}>${escapeHtml(environment.envName)}</option>`
        )
        .join("")
    : `<option value="">暂无环境</option>`;
}

function renderExecutionCaseOptions() {
  renderExecutionCasePicker();
}

function renderExecutionModuleFilter() {
  const select = $("execution-module-filter");
  if (!select) return;
  select.innerHTML =
    `<option value="">全部模块</option>` +
    state.caseGroups
      .map(
        (group) =>
          `<option value="${group.id}" ${String(group.id) === String(state.executionCaseModuleFilter || "") ? "selected" : ""}>${escapeHtml(group.groupName)}</option>`
      )
      .join("");
}

function renderTransferCaseItem(testCase, side) {
  const isTarget = side === "target";
  const action = isTarget ? "remove-execution-case" : "add-execution-case";
  const buttonText = isTarget ? "移回" : "添加";
  return `<div class="transfer-item" data-case-id="${testCase.id}">
    <div>
      <strong>${escapeHtml(testCase.caseName)}</strong>
      <p class="meta">${escapeHtml(testCase.caseCode || "-")} · ${escapeHtml(testCase.groupName || "未分组")} · ${Number(testCase.stepCount || 0)} 步</p>
    </div>
    <div class="transfer-actions">
      ${
        isTarget
          ? `<button class="secondary small" data-action="move-execution-case" data-case-id="${testCase.id}" data-direction="-1">上移</button>
             <button class="secondary small" data-action="move-execution-case" data-case-id="${testCase.id}" data-direction="1">下移</button>`
          : ""
      }
      <button class="small ${isTarget ? "secondary" : ""}" data-action="${action}" data-case-id="${testCase.id}">${buttonText}</button>
    </div>
  </div>`;
}

function renderExecutionCasePicker() {
  renderExecutionModuleFilter();
  const selectedIds = state.selectedExecutionCaseIds.map(Number);
  const activeCases = state.cases.filter((item) => Number(item.status) !== 0);
  state.selectedExecutionCaseIds = selectedIds.filter((caseId) =>
    activeCases.some((item) => Number(item.id) === Number(caseId))
  );
  const sourceCases = activeCases.filter((item) => {
    if (state.selectedExecutionCaseIds.includes(Number(item.id))) return false;
    if (state.executionCaseModuleFilter && String(item.caseGroupId || "") !== String(state.executionCaseModuleFilter)) {
      return false;
    }
    return true;
  });
  const targetCases = state.selectedExecutionCaseIds
    .map((caseId) => activeCases.find((item) => Number(item.id) === Number(caseId)))
    .filter(Boolean);
  const source = $("execution-case-source");
  const target = $("execution-case-target");
  if (source) {
    source.innerHTML = sourceCases.length
      ? sourceCases.map((item) => renderTransferCaseItem(item, "source")).join("")
      : `<div class="empty-state compact-empty">暂无可选用例。</div>`;
  }
  if (target) {
    target.innerHTML = targetCases.length
      ? targetCases.map((item) => renderTransferCaseItem(item, "target")).join("")
      : `<div class="empty-state compact-empty">请从左侧添加待执行用例。</div>`;
  }
  setText("execution-selected-count", `${targetCases.length} 个`);
}

function addExecutionCase(caseId) {
  const normalizedCaseId = Number(caseId);
  if (!state.selectedExecutionCaseIds.map(Number).includes(normalizedCaseId)) {
    state.selectedExecutionCaseIds.push(normalizedCaseId);
  }
  renderExecutionCasePicker();
  renderShell();
}

function removeExecutionCase(caseId) {
  const normalizedCaseId = Number(caseId);
  state.selectedExecutionCaseIds = state.selectedExecutionCaseIds.filter((id) => Number(id) !== normalizedCaseId);
  renderExecutionCasePicker();
  renderShell();
}

function moveExecutionCase(caseId, direction) {
  const normalizedCaseId = Number(caseId);
  const index = state.selectedExecutionCaseIds.findIndex((id) => Number(id) === normalizedCaseId);
  const nextIndex = index + Number(direction || 0);
  if (index < 0 || nextIndex < 0 || nextIndex >= state.selectedExecutionCaseIds.length) {
    return;
  }
  const nextIds = state.selectedExecutionCaseIds.slice();
  const [item] = nextIds.splice(index, 1);
  nextIds.splice(nextIndex, 0, item);
  state.selectedExecutionCaseIds = nextIds;
  renderExecutionCasePicker();
}

function moveSelectedExecutionCase(direction) {
  const selectedCaseId = state.selectedExecutionCaseIds[0];
  if (selectedCaseId) moveExecutionCase(selectedCaseId, direction);
}

async function loadJobs() {
  state.jobs = await api(`/api/execution-jobs?projectId=${state.selectedProjectId}`);
  renderJobList();
  renderReports();
}

async function loadMembers() {
  state.members = await api(`/api/projects/${state.selectedProjectId}/members`);
  renderMembers();
}

async function loadUsers() {
  state.users = await api("/api/users");
  const userOptions = state.users
    .map((user) => `<option value="${user.id}">${escapeHtml(user.displayName || user.username)}（${escapeHtml(user.username)}）</option>`)
    .join("");
  if ($("member-user-select")) $("member-user-select").innerHTML = userOptions;
  if ($("new-project-members")) $("new-project-members").innerHTML = userOptions;
}

function treeKey(pageId, componentId = "") {
  return `${pageId}:${componentId}`;
}

function renderOverview() {
  const latestCompletedJob = reportJobs()[0] || null;
  const latestJob = latestCompletedJob || state.jobs[0] || null;
  const latestFailedCase = state.cases
    .filter((item) => item.latestExecutionStatus === "failed")
    .sort((a, b) => String(b.latestExecutionAt || "").localeCompare(String(a.latestExecutionAt || "")))[0];
  const latestAbnormalElement = state.elements
    .filter((item) => Number(item.validStatus) === 0)
    .sort((a, b) => String(b.lastValidatedAt || "").localeCompare(String(a.lastValidatedAt || "")))[0];
  const latestActiveMember = state.members
    .slice()
    .sort((a, b) => String(b.lastActiveAt || b.createdAt || "").localeCompare(String(a.lastActiveAt || a.createdAt || "")))[0];
  const latestRecording = state.recordings[0];

  function renderOverviewCard({ title, view, emptyText, rows }) {
    return `<div class="panel overview-card">
      <div class="panel-heading panel-heading-action">
        <div>
          <h3>${title}</h3>
        </div>
        <button class="secondary small" data-action="overview-more" data-view="${view}">查看更多</button>
      </div>
      <div class="settings-list">
        ${
          rows.length
            ? rows
                .map(
                  (row) => `<div class="settings-row">
                    <span>${row.label}</span>
                    <strong>${row.value}</strong>
                  </div>`
                )
                .join("")
            : `<div class="empty-state overview-empty">${emptyText}</div>`
        }
      </div>
    </div>`;
  }

  $("overview-grid").innerHTML = `
    ${renderOverviewCard({
      title: "\u6700\u8fd1\u4e00\u6b21\u6267\u884c",
      summary: "\u53ea\u5c55\u793a\u5f53\u524d\u9879\u76ee\u6700\u65b0\u4e00\u6761\u6267\u884c\u8bb0\u5f55\u3002",
      view: "tasks",
      emptyText: "\u6682\u65e0\u6267\u884c\u4efb\u52a1\u3002",
      rows: latestJob
        ? [
            { label: "\u4efb\u52a1\u7f16\u53f7", value: escapeHtml(latestJob.jobNo || "-") },
            { label: "\u6267\u884c\u72b6\u6001", value: badge(latestJob.status) },
            {
              label: "\u901a\u8fc7\u7387",
              value:
                latestCompletedJob && Number(latestJob.totalCases || 0) > 0
                  ? `${calcPassRate(latestJob)}%`
                  : "-"
            },
            {
              label: "\u5b8c\u6210\u65f6\u95f4",
              value: fmt(latestJob.finishedAt || latestJob.updatedAt || latestJob.startedAt)
            }
          ]
        : []
    })}
    ${renderOverviewCard({
      title: "\u6700\u8fd1\u5f55\u5236",
      summary: "\u53ea\u5c55\u793a\u6700\u65b0\u4e00\u6761\u5f55\u5236\u4f1a\u8bdd\u3002",
      view: "recordings",
      emptyText: "\u6682\u65e0\u5f55\u5236\u4f1a\u8bdd\u3002",
      rows: latestRecording
        ? [
            { label: "\u4f1a\u8bdd\u7f16\u53f7", value: escapeHtml(latestRecording.sessionNo || "-") },
            { label: "\u5f55\u5236\u72b6\u6001", value: badge(latestRecording.status) },
            {
              label: "\u6d4f\u89c8\u5668 / \u6a21\u5f0f",
              value: `${escapeHtml(latestRecording.browser || "-")} / ${escapeHtml(latestRecording.mode || "-")}`
            },
            { label: "\u5f55\u5236\u65f6\u95f4", value: fmt(latestRecording.stoppedAt || latestRecording.createdAt) }
          ]
        : []
    })}
    ${renderOverviewCard({
      title: "\u6700\u8fd1\u5f02\u5e38\u5143\u7d20",
      summary: "\u53ea\u5c55\u793a\u6700\u65b0\u4e00\u6761\u5b9a\u4f4d\u5f02\u5e38\u5143\u7d20\u3002",
      view: "elements",
      emptyText: "\u6682\u65e0\u5f02\u5e38\u5143\u7d20\u3002",
      rows: latestAbnormalElement
        ? [
            { label: "\u5143\u7d20\u540d\u79f0", value: escapeHtml(latestAbnormalElement.elementName || "-") },
            {
              label: "\u6240\u5c5e\u4f4d\u7f6e",
              value: `${escapeHtml(latestAbnormalElement.pageName || "\u672a\u5206\u7ec4\u9875\u9762")} / ${escapeHtml(latestAbnormalElement.componentName || "\u672a\u5206\u7ec4\u7ec4\u4ef6")}`
            },
            {
              label: "\u4e3b\u5b9a\u4f4d",
              value: `${escapeHtml(latestAbnormalElement.primaryLocatorType || "-")} / ${escapeHtml(latestAbnormalElement.primaryLocatorValue || "-")}`
            },
            { label: "\u6700\u8fd1\u6821\u9a8c\u65f6\u95f4", value: fmt(latestAbnormalElement.lastValidatedAt) }
          ]
        : []
    })}
    ${renderOverviewCard({
      title: "\u6700\u8fd1\u5931\u8d25\u7528\u4f8b",
      summary: "\u53ea\u5c55\u793a\u6700\u65b0\u4e00\u6761\u5931\u8d25\u7528\u4f8b\u8bb0\u5f55\u3002",
      view: "cases",
      emptyText: "\u6682\u65e0\u5931\u8d25\u7528\u4f8b\u3002",
      rows: latestFailedCase
        ? [
            { label: "\u7528\u4f8b\u540d\u79f0", value: escapeHtml(latestFailedCase.caseName || "-") },
            { label: "\u7528\u4f8b\u7f16\u7801", value: escapeHtml(latestFailedCase.caseCode || "-") },
            { label: "\u6240\u5c5e\u5206\u7ec4", value: escapeHtml(latestFailedCase.groupName || "\u672a\u5206\u7ec4") },
            { label: "\u6700\u8fd1\u5931\u8d25\u65f6\u95f4", value: fmt(latestFailedCase.latestExecutionAt) }
          ]
        : []
    })}
    ${renderOverviewCard({
      title: "\u6700\u8fd1\u6d3b\u8dc3\u6210\u5458",
      summary: "\u53ea\u5c55\u793a\u6700\u65b0\u4e00\u6761\u6210\u5458\u6d3b\u8dc3\u8bb0\u5f55\u3002",
      view: "members",
      emptyText: "\u6682\u65e0\u6d3b\u8dc3\u6210\u5458\u8bb0\u5f55\u3002",
      rows: latestActiveMember
        ? [
            { label: "\u6210\u5458", value: escapeHtml(latestActiveMember.displayName || latestActiveMember.username || "-") },
            {
              label: "\u9879\u76ee\u89d2\u8272",
              value: escapeHtml(roleNames[latestActiveMember.projectRole] || latestActiveMember.projectRole || "-")
            },
            { label: "\u6210\u5458\u72b6\u6001", value: badge(latestActiveMember.status || "unknown") },
            { label: "\u6700\u8fd1\u6d3b\u8dc3\u65f6\u95f4", value: fmt(latestActiveMember.lastActiveAt || latestActiveMember.createdAt) }
          ]
        : []
    })}`;
}

function renderElementTree() {
  const renameButton = (type, id, currentName, extraAttrs = "") =>
    `<button type="button" class="tree-rename" data-action="rename-tree-node" data-node-type="${type}" data-node-id="${id}" data-current-name="${escapeHtml(currentName)}" ${extraAttrs}>编辑</button>`;
  const deleteButton = (type, id, currentName, extraAttrs = "") =>
    `<button type="button" class="tree-delete" data-action="delete-tree-node" data-node-type="${type}" data-node-id="${id}" data-current-name="${escapeHtml(currentName)}" ${extraAttrs}>删除</button>`;
  const pages = new Map();
  let total = 0;
  for (const item of state.elementTree) {
    const pageId = item.pageId ? String(item.pageId) : "-1";
    if (!pages.has(pageId)) {
      pages.set(pageId, {
        pageId,
        pageName: item.pageName || "未分组页面",
        count: 0,
        components: new Map()
      });
    }
    const page = pages.get(pageId);
    const componentId = item.componentId ? String(item.componentId) : "unassigned";
    if (!page.components.has(componentId)) {
      page.components.set(componentId, {
        componentId,
        componentName: item.componentName || "未分组组件",
        count: 0,
        pageId
      });
    }
    const component = page.components.get(componentId);
    const count = Number(item.elementCount || 0);
    component.count += count;
    page.count += count;
    total += count;
  }

  for (const element of state.elements) {
    const pageId = String(element.pageId || -1);
    const pageName = element.pageName || "未分组页面";
    const componentId = String(element.componentId || "unassigned");
    const componentName = element.componentName || "未分组组件";
    if (!pages.has(pageId)) {
      pages.set(pageId, {
        pageId,
        pageName,
        count: 0,
        components: new Map()
      });
    }
    const page = pages.get(pageId);
    if (!page.components.has(componentId)) {
      page.components.set(componentId, {
        componentId,
        componentName,
        count: 0,
        pageId
      });
    }
    const component = page.components.get(componentId);
    component.elements = component.elements || [];
    component.elements.push(element);
  }

  const pageHtml = Array.from(pages.values())
    .map((page, pageIndex) => {
      const pageShouldOpen =
        state.elementTreeOpenPages.has(page.pageId) ||
        state.selectedElementPageId === page.pageId ||
        (!state.elementTreeOpenPages.size && pageIndex === 0);
      const pageOpen = pageShouldOpen ? "open" : "";
      const pageActive = state.selectedElementPageId === page.pageId ? "active" : "";
      const canRenamePage = page.pageId !== "-1";
      const componentsHtml = Array.from(page.components.values())
        .map((component, componentIndex) => {
          const componentKey = treeKey(page.pageId, component.componentId);
          const componentShouldOpen =
            state.elementTreeOpenComponents.has(componentKey) ||
            (pageShouldOpen && !state.elementTreeOpenComponents.size && componentIndex === 0);
          const componentOpen = componentShouldOpen ? "open" : "";
          const elementsHtml = (component.elements || [])
            .map(
              (element) => `<div class="tree-leaf">
                <button type="button" class="tree-leaf-main" data-action="element-detail" data-element-id="${element.id}">
                  <span class="tree-node-main">${escapeHtml(element.elementName)}</span>
                  <small>${escapeHtml(element.primaryLocatorType || element.elementType || "-")}</small>
                </button>
                <span class="tree-node-actions">${renameButton("element", element.id, element.elementName)}${deleteButton("element", element.id, element.elementName)}</span>
              </div>`
            )
            .join("");
          return `<details class="tree-group tree-group-component" data-tree-level="component" data-tree-key="${componentKey}" ${componentOpen}>
            <summary class="tree-summary">
              <span class="tree-caret"></span>
              <span class="tree-node-main">${escapeHtml(component.componentName)}</span>
              <strong class="tree-node-count">${component.count}</strong>
              <span class="tree-node-actions">${renameButton(
                "component",
                component.componentId,
                component.componentName,
                `data-page-id="${component.pageId}" data-virtual="${component.componentId === "unassigned" ? "1" : "0"}"`
              )}${component.componentId === "unassigned" ? "" : deleteButton("component", component.componentId, component.componentName)}</span>
            </summary>
            <div class="tree-children">
              ${elementsHtml || `<p class="meta tree-empty">当前筛选条件下暂无元素。</p>`}
            </div>
          </details>`;
        })
        .join("");
      return `<details class="tree-group tree-group-page" data-tree-level="page" data-tree-key="${page.pageId}" ${pageOpen}>
        <summary class="tree-summary ${pageActive}">
          <span class="tree-caret"></span>
          <button type="button" class="tree-page-select" data-action="select-element-page" data-page-id="${page.pageId}">
            <span class="tree-node-main">${escapeHtml(page.pageName)}</span>
          </button>
          <strong class="tree-node-count">${page.count}</strong>
          <span class="tree-node-actions">${canRenamePage ? `${renameButton("page", page.pageId, page.pageName)}${deleteButton("page", page.pageId, page.pageName)}` : ""}</span>
        </summary>
        <div class="tree-children">
          ${componentsHtml || `<p class="meta tree-empty">暂无组件。</p>`}
        </div>
      </details>`;
    })
    .join("");

  return `<button class="tree-button ${state.selectedElementPageId === "all" ? "active" : ""}" data-action="select-element-page" data-page-id="all">
    <span class="tree-node-main">全部页面</span><strong>${total}</strong>
  </button>${pageHtml}`;
}

function renderElementTable(elements) {
  return `<table class="data-table element-table">
      <thead>
        <tr>
          <th>元素名称</th>
          <th>页面</th>
          <th>组件</th>
          <th>元素类型</th>
          <th>默认动作</th>
          <th>主定位方式</th>
          <th>主定位值</th>
          <th>有效状态</th>
          <th>创建来源</th>
          <th>创建人</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>${elements.map(renderElementRow).join("")}</tbody>
    </table>`;
}

function renderElementRow(element) {
  const actions = renderActionMenu({
    detail: {
      label: "编辑",
      action: "element-detail",
      attrs: `data-element-id="${element.id}"`
    },
    more: [
      {
        label: "删除",
        action: "disable-element",
        attrs: `data-element-id="${element.id}"`,
        variant: "danger"
      }
    ]
  });
  return `<tr class="element-row" data-element-id="${element.id}">
    <td class="element-name-cell"><strong>${escapeHtml(element.elementName)}</strong></td>
    <td>${escapeHtml(element.pageName || "未分组页面")}</td>
    <td>${escapeHtml(element.componentName || "未分组组件")}</td>
    <td>${escapeHtml(element.elementType || "-")}</td>
    <td>${escapeHtml(element.defaultAction || "-")}</td>
    <td>${escapeHtml(element.primaryLocatorType || "-")}</td>
    <td class="cell-url">${escapeHtml(element.primaryLocatorValue || "-")}</td>
    <td>${badge(validStatusLabel(element.validStatus))}</td>
    <td>${element.sourceType === "recording" ? "录制生成" : "手动创建"}</td>
    <td>${escapeHtml(element.createdByName || "-")}</td>
    <td>${actions}</td>
  </tr>`;
}

function validStatusLabel(status) {
  if (Number(status) === 1) return "valid";
  return "invalid";
}

function renderRecordingCard(session) {
  const canMaterialize = Number(session.eventCount) > 0;
  const canDelete = true;
  return `<article class="item">
    <div class="item-head">
      <div>
        <p class="item-title">${escapeHtml(session.sessionNo)}</p>
        <p class="meta">项目：${escapeHtml(session.projectName || "-")} · 环境：${escapeHtml(session.environmentName || "-")}</p>
        <p class="meta">URL：${escapeHtml(session.startUrl || "-")}</p>
        <p class="meta">${escapeHtml(session.browser)} · ${escapeHtml(session.mode)} · ${session.eventCount} 个事件 · 创建人：${escapeHtml(session.createdByName || "-")}</p>
        <p class="meta">创建：${fmt(session.createdAt)} · 停止：${fmt(session.stoppedAt)}</p>
      </div>
      ${badge(session.status)}
    </div>
    <div class="actions">
      <button class="small secondary" data-action="recording-events" data-session="${escapeHtml(session.sessionNo)}">查看事件</button>
      <button class="small" ${canMaterialize ? "" : "disabled"} data-action="materialize" data-session="${escapeHtml(session.sessionNo)}">生成用例</button>
      <button class="small danger" ${canDelete ? "" : "disabled"} data-action="delete-recording" data-session="${escapeHtml(session.sessionNo)}">删除</button>
    </div>
  </article>`;
}

function renderRecordingTable(sessions) {
  return `<div class="list-pane">
    <div class="table-wrap list-scroll">
      <table class="data-table recording-table">
      <thead>
        <tr>
          <th>会话编号</th>
          <th>项目</th>
          <th>环境</th>
          <th>URL</th>
          <th>浏览器</th>
          <th>模式</th>
          <th>事件数</th>
          <th>状态</th>
          <th>创建人</th>
          <th>创建时间</th>
          <th>停止时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>${sessions.map(renderRecordingRow).join("")}</tbody>
      </table>
    </div>
    ${renderRecordingPagination()}
  </div>`;
}

function renderRecordingRow(session) {
  const canMaterialize = Number(session.eventCount) > 0;
  const canDelete = true;
  const actions = renderActionMenu({
    detail: {
      label: "查看详情",
      action: "recording-events",
      attrs: `data-session="${escapeHtml(session.sessionNo)}"`
    },
    more: [
      {
        label: "生成用例",
        action: "materialize",
        attrs: `data-session="${escapeHtml(session.sessionNo)}"`,
        disabled: !canMaterialize
      },
      {
        label: "删除",
        action: "delete-recording",
        attrs: `data-session="${escapeHtml(session.sessionNo)}"`,
        disabled: !canDelete,
        variant: "danger"
      }
    ]
  });
  return `<tr>
    <td><strong>${escapeHtml(session.sessionNo)}</strong></td>
    <td>${escapeHtml(session.projectName || "-")}</td>
    <td>${escapeHtml(session.environmentName || "-")}</td>
    <td class="cell-url" title="${escapeHtml(session.startUrl || "-")}">${escapeHtml(session.startUrl || "-")}</td>
    <td>${escapeHtml(session.browser || "-")}</td>
    <td>${escapeHtml(session.mode || "-")}</td>
    <td>${session.eventCount}</td>
    <td>${badge(session.status)}</td>
    <td>${escapeHtml(session.createdByName || "-")}</td>
    <td>${fmt(session.createdAt)}</td>
    <td>${fmt(session.stoppedAt)}</td>
    <td>${actions}</td>
  </tr>`;
}

function renderRecordingPagination() {
  return `<div class="pagination">
    <span>共 ${state.recordingTotal} 条，第 ${state.recordingPage} / ${state.recordingTotalPages} 页</span>
    <button class="secondary" data-action="recording-page" data-page="${state.recordingPage - 1}" ${state.recordingPage <= 1 ? "disabled" : ""}>上一页</button>
    <button class="secondary" data-action="recording-page" data-page="${state.recordingPage + 1}" ${state.recordingPage >= state.recordingTotalPages ? "disabled" : ""}>下一页</button>
  </div>`;
}

function renderCase(testCase) {
  return `<article class="item">
    <div class="item-head">
      <div>
        <p class="item-title">${escapeHtml(testCase.caseName)}</p>
        <p class="meta">${escapeHtml(testCase.caseCode || "-")} · ${testCase.stepCount} 步 · ${escapeHtml(testCase.priority)}</p>
      </div>
      ${badge(testCase.status === 1 ? "active" : "disabled")}
    </div>
    <div class="actions">
      <button class="small" data-action="run" data-case-id="${testCase.id}">执行用例</button>
      <button class="small secondary" data-action="case-detail" data-case-id="${testCase.id}">查看详情</button>
    </div>
  </article>`;
}

function renderCaseTable(cases) {
  return `<table class="data-table case-table">
    <thead>
      <tr>
        <th>选择</th>
        <th>用例名称</th>
        <th>用例编码</th>
        <th>所属模块</th>
        <th>优先级</th>
        <th>步骤数</th>
        <th>最近执行状态</th>
        <th>最近执行时间</th>
        <th>创建人</th>
        <th>状态</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>${cases.map(renderCaseRow).join("")}</tbody>
  </table>`;
}

function renderCaseRow(testCase) {
  const actions = renderActionMenu({
    detail: {
      label: "查看详情",
      action: "case-detail",
      attrs: `data-case-id="${testCase.id}"`
    },
    more: [
      {
        label: "执行",
        action: "run",
        attrs: `data-case-id="${testCase.id}"`
      },
      {
        label: "复制",
        action: "copy-case",
        attrs: `data-case-id="${testCase.id}"`
      },
      {
        label: "删除",
        action: "delete-case",
        attrs: `data-case-id="${testCase.id}"`,
        variant: "danger"
      }
    ]
  });
  const selected = state.selectedExecutionCaseIds.map(Number).includes(Number(testCase.id));
  return `<tr>
    <td><input type="checkbox" data-action="toggle-execution-case" data-case-id="${testCase.id}" ${selected ? "checked" : ""} /></td>
    <td><strong>${escapeHtml(testCase.caseName)}</strong></td>
    <td>${escapeHtml(testCase.caseCode || "-")}</td>
    <td><select class="small-select" data-action="change-case-group" data-case-id="${testCase.id}">${caseGroupOptions(testCase.caseGroupId)}</select></td>
    <td>${escapeHtml(priorityLabel(testCase.priority))}</td>
    <td>${testCase.stepCount}</td>
    <td>${testCase.latestExecutionStatus ? badge(testCase.latestExecutionStatus) : "-"}</td>
    <td>${fmt(testCase.latestExecutionAt)}</td>
    <td>${escapeHtml(testCase.createdByName || "-")}</td>
    <td>${badge(testCase.status === 1 ? "active" : "disabled")}</td>
    <td>${actions}</td>
  </tr>`;
}

function priorityLabel(priority) {
  if (priority === "high") return "高";
  if (priority === "low") return "低";
  return "中";
}

function renderJob(job) {
  return `<article class="item">
    <div class="item-head">
      <div>
        <p class="item-title">${escapeHtml(job.jobNo)}</p>
        <p class="meta">${escapeHtml(job.environmentName || "-")} · ${escapeHtml(job.browser)} · ${job.passedCases}/${job.totalCases} 通过 · ${fmt(job.createdAt)}</p>
      </div>
      ${badge(job.status)}
    </div>
    <div class="actions">
      <button class="small secondary" data-action="job" data-job-no="${escapeHtml(job.jobNo)}">查看详情</button>
    </div>
  </article>`;
}

function renderJobList() {
  const keyword = $("job-keyword")?.value?.trim().toLowerCase() || "";
  const status = $("job-status-filter")?.value || "";
  const filteredJobs = state.jobs.filter((job) => {
    if (status && job.status !== status) return false;
    if (!keyword) return true;
    return [job.jobNo, job.environmentName, job.browser, job.createdByName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });
  const pagination = paginate(filteredJobs, state.jobPage, state.jobPageSize);
  state.jobPage = pagination.page;
  $("job-list").innerHTML = filteredJobs.length
    ? renderPagedTable({
        key: "job",
        page: pagination.page,
        total: pagination.total,
        totalPages: pagination.totalPages,
        tableHtml: `<table class="data-table job-table">
          <thead>
            <tr>
              <th>任务编号</th>
              <th>执行环境</th>
              <th>浏览器</th>
              <th>用例数</th>
              <th>通过数</th>
              <th>失败数</th>
              <th>状态</th>
              <th>执行人</th>
              <th>开始时间</th>
              <th>结束时间</th>
              <th>耗时</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${pagination.items.map(renderJobRow).join("")}</tbody>
        </table>`
      })
    : `<div class="empty-state">暂无执行任务。</div>`;
}

function renderJobRow(job) {
  const actions = renderActionMenu({
    detail: {
      label: "查看详情",
      action: "job-modal",
      attrs: `data-job-no="${escapeHtml(job.jobNo)}"`
    },
    more: [
      {
        label: "重新执行",
        action: "job-rerun",
        attrs: `data-job-no="${escapeHtml(job.jobNo)}"`
      },
      {
        label: "删除",
        action: "delete-job",
        attrs: `data-job-no="${escapeHtml(job.jobNo)}"`,
        variant: "danger"
      }
    ]
  });
  return `<tr>
    <td class="cell-url" title="${escapeHtml(job.jobNo)}">${escapeHtml(job.jobNo)}</td>
    <td>${escapeHtml(job.environmentName || "-")}</td>
    <td>${escapeHtml(job.browser || "-")}</td>
    <td>${Number(job.totalCases || 0)}</td>
    <td>${Number(job.passedCases || 0)}</td>
    <td>${Number(job.failedCases || 0)}</td>
    <td>${badge(job.status)}</td>
    <td>${escapeHtml(job.createdByName || "-")}</td>
    <td>${fmt(job.startedAt || job.queuedAt || job.createdAt)}</td>
    <td>${fmt(job.finishedAt)}</td>
    <td>${fmtDuration(job.durationMs)}</td>
    <td>${actions}</td>
  </tr>`;
}

function renderReports() {
  const from = $("report-from")?.value ? new Date(`${$("report-from").value}T00:00:00`) : null;
  const to = $("report-to")?.value ? new Date(`${$("report-to").value}T23:59:59`) : null;
  const executor = $("report-executor")?.value?.trim().toLowerCase() || "";
  const minPassRate = Number($("report-pass-rate")?.value || 0);
  const reportJobs = state.jobs
    .filter((job) => job.finishedAt || ["passed", "failed", "canceled", "timeout"].includes(job.status))
    .filter((job) => {
      const finishedAt = job.finishedAt || job.updatedAt || job.createdAt;
      const time = finishedAt ? new Date(finishedAt) : null;
      if (from && time && time < from) return false;
      if (to && time && time > to) return false;
      if (executor && !String(job.createdByName || "").toLowerCase().includes(executor)) return false;
      if (minPassRate && calcPassRate(job) < minPassRate) return false;
      return true;
    });
  const pagination = paginate(reportJobs, state.reportPage, state.reportPageSize);
  state.reportPage = pagination.page;
  $("report-list").innerHTML = reportJobs.length
    ? renderPagedTable({
        key: "report",
        page: pagination.page,
        total: pagination.total,
        totalPages: pagination.totalPages,
        tableHtml: `<table class="data-table report-table">
          <thead>
            <tr>
              <th>报告编号</th>
              <th>执行环境</th>
              <th>浏览器</th>
              <th>通过率</th>
              <th>用例结果</th>
              <th>执行人</th>
              <th>完成时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${pagination.items.map(renderReportRow).join("")}</tbody>
        </table>`
      })
    : `<div class="empty-state">暂无测试报告。执行任务完成后会沉淀在这里。</div>`;
}

function renderReportRow(job) {
  const actions = renderActionMenu({
    detail: {
      label: "查看详情",
      action: "job-modal",
      attrs: `data-job-no="${escapeHtml(job.jobNo)}"`
    },
    more: [
      {
        label: "下载",
        action: "download-report",
        attrs: `data-job-no="${escapeHtml(job.jobNo)}"`
      },
      {
        label: "删除",
        action: "delete-job",
        attrs: `data-job-no="${escapeHtml(job.jobNo)}"`,
        variant: "danger"
      }
    ]
  });
  return `<tr>
    <td class="cell-url" title="${escapeHtml(job.jobNo)}">${escapeHtml(job.jobNo)}</td>
    <td>${escapeHtml(job.environmentName || "-")}</td>
    <td>${escapeHtml(job.browser || "-")}</td>
    <td>${calcPassRate(job)}%</td>
    <td>${Number(job.passedCases || 0)} 通过 / ${Number(job.failedCases || 0)} 失败 / ${Number(job.totalCases || 0)} 总数</td>
    <td>${escapeHtml(job.createdByName || "-")}</td>
    <td>${fmt(job.finishedAt || job.updatedAt)}</td>
    <td>${badge(job.status)}</td>
    <td>${actions}</td>
  </tr>`;
}

function renderMembers() {
  const disabled = canManageMembers() ? "" : "disabled";
  const keyword = $("member-keyword")?.value?.trim().toLowerCase() || "";
  const status = $("member-status-filter")?.value || "";
  const projectRole = $("member-role-filter")?.value || "";
  $("open-member-modal-button").disabled = !canManageMembers();
  $("add-member-button").disabled = !canManageMembers();
  $("member-role-select").disabled = !canManageMembers();
  $("member-user-select").disabled = !canManageMembers();
  setMemberMessage(canManageMembers() ? "" : "当前账号仅具备项目成员查看权限。");
  const filteredMembers = state.members.filter((member) => {
    if (status && member.status !== status) return false;
    if (projectRole && member.projectRole !== projectRole) return false;
    if (!keyword) return true;
    return [member.username, member.displayName, member.email]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(keyword));
  });
  const pagination = paginate(filteredMembers, state.memberPage, state.memberPageSize);
  state.memberPage = pagination.page;
  $("member-list").innerHTML = filteredMembers.length
    ? renderPagedTable({
        key: "member",
        page: pagination.page,
        total: pagination.total,
        totalPages: pagination.totalPages,
        tableHtml: `<table class="data-table member-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>显示名称</th>
              <th>邮箱</th>
              <th>项目角色</th>
              <th>加入时间</th>
              <th>最近操作时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${pagination.items.map((member) => renderMemberRow(member, disabled)).join("")}</tbody>
        </table>`
      })
    : `<div class="empty-state">暂无项目成员。</div>`;
}

function renderMemberRow(member, disabled) {
  const actions = renderActionMenu({
    more: [
      {
        label: "禁用",
        action: "disable-member",
        attrs: `data-member-id="${member.id}"`,
        disabled: Boolean(disabled),
        variant: "danger"
      },
      {
        label: "移除",
        action: "remove-member",
        attrs: `data-member-id="${member.id}"`,
        disabled: Boolean(disabled),
        variant: "danger"
      }
    ]
  });
  return `<tr>
    <td>${escapeHtml(member.username)}</td>
    <td>${escapeHtml(member.displayName || "-")}</td>
    <td>${escapeHtml(member.email || "-")}</td>
    <td>
      <select class="small-select" data-action="change-member-role" data-member-id="${member.id}" ${disabled}>
        ${["project_admin", "test_lead", "tester", "viewer"]
          .map(
            (role) =>
              `<option value="${role}" ${member.projectRole === role ? "selected" : ""}>${roleNames[role]}</option>`
          )
          .join("")}
      </select>
    </td>
    <td>${fmt(member.joinedAt)}</td>
    <td>${fmt(member.lastActiveAt)}</td>
    <td>${badge(member.status)}</td>
    <td>${actions}</td>
  </tr>`;
}

function renderProjectTable(projects) {
  return `<table class="data-table project-table">
    <thead>
      <tr>
        <th>项目名称</th>
        <th>项目编码</th>
        <th>我的角色</th>
        <th>成员数</th>
        <th>环境数</th>
        <th>用例数</th>
        <th>最近执行时间</th>
        <th>状态</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${projects
        .map(
          (item) => {
            const canManageRowSettings = state.user?.roleCode === "admin" || item.projectRole === "project_admin";
            return `<tr>
            <td><strong>${escapeHtml(item.projectName)}</strong></td>
            <td>${escapeHtml(item.projectCode)}</td>
            <td>${escapeHtml(roleNames[item.projectRole] || item.projectRole || "-")}</td>
            <td>${Number(item.memberCount || 0)}</td>
            <td>${Number(item.environmentCount || 0)}</td>
            <td>${Number(item.caseCount || 0)}</td>
            <td>${fmt(item.latestExecutionAt)}</td>
            <td>${badge(item.status === 1 ? "active" : "disabled")}</td>
            <td>${renderActionMenu({
              detail: {
                label: Number(item.id) === Number(state.selectedProjectId) ? "当前项目" : "切换",
                action: "select-project",
                attrs: `data-project-id="${item.id}"`,
                disabled: Number(item.id) === Number(state.selectedProjectId)
              },
              more: [
                {
                  label: "编辑",
                  action: "edit-project",
                  attrs: `data-project-id="${item.id}"`,
                  disabled: !canManageRowSettings
                },
                {
                  label: "环境设置",
                  action: "manage-project-environments",
                  attrs: `data-project-id="${item.id}" data-project-name="${escapeHtml(item.projectName)}"`,
                  disabled: !canManageRowSettings
                },
                {
                  label: "模块设置",
                  action: "manage-project-modules",
                  attrs: `data-project-id="${item.id}" data-project-name="${escapeHtml(item.projectName)}"`,
                  disabled: !canManageRowSettings
                },
                {
                  label: "删除",
                  action: "delete-project",
                  attrs: `data-project-id="${item.id}"`,
                  disabled: !canManageRowSettings,
                  variant: "danger"
                }
              ]
            })}</td>
          </tr>`;
          }
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderEnvironmentTable(environments) {
  return `<table class="data-table environment-table">
    <thead>
      <tr>
        <th>环境名称</th>
        <th>环境编码</th>
        <th>类型</th>
        <th>Base URL</th>
        <th>允许执行</th>
        <th>确认执行</th>
        <th>更新时间</th>
        <th>状态</th>
      </tr>
    </thead>
    <tbody>
      ${environments
        .map(
          (environment) => `<tr>
            <td><strong>${escapeHtml(environment.envName)}</strong></td>
            <td>${escapeHtml(environment.envCode || "-")}</td>
            <td>${escapeHtml(environmentTypeLabels[environment.envType] || environment.envType || "-")}</td>
            <td class="cell-url" title="${escapeHtml(environment.baseUrl || "-")}">${escapeHtml(environment.baseUrl || "-")}</td>
            <td>${environment.allowExecution ? "是" : "否"}</td>
            <td>${environment.requireConfirm ? "是" : "否"}</td>
            <td>${fmt(environment.updatedAt || environment.createdAt)}</td>
            <td>${badge(environment.allowExecution ? "active" : "disabled")}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderEnvironmentManageRows() {
  return state.environmentManageItems.length
    ? state.environmentManageItems
        .map(
          (environment) => `<tr>
            <td><strong>${escapeHtml(environment.envName)}</strong></td>
            <td>${escapeHtml(environment.envCode || "-")}</td>
            <td>${escapeHtml(environmentTypeLabels[environment.envType] || environment.envType || "-")}</td>
            <td class="cell-url" title="${escapeHtml(environment.baseUrl || "-")}">${escapeHtml(environment.baseUrl || "-")}</td>
            <td>${environment.allowExecution ? "是" : "否"}</td>
            <td>${environment.requireConfirm ? "是" : "否"}</td>
            <td>${fmt(environment.updatedAt || environment.createdAt)}</td>
            <td>${renderActionMenu({
              detail: {
                label: "编辑",
                action: "edit-managed-environment",
                attrs: `data-environment-id="${environment.id}"`
              },
              more: [
                {
                  label: "删除",
                  action: "delete-managed-environment",
                  attrs: `data-environment-id="${environment.id}"`,
                  variant: "danger"
                }
              ]
            })}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="8">暂无环境。</td></tr>`;
}

function environmentFormValues() {
  const editing = state.environmentManageItems.find((item) => Number(item.id) === Number(state.environmentEditingId));
  return editing || {
    envName: "",
    envCode: "",
    envType: "test",
    baseUrl: selectedEnvironment()?.baseUrl || "",
    description: "",
    allowExecution: true,
    requireConfirm: false
  };
}

function renderEnvironmentManageModal() {
  setText("environment-manage-title", `${state.environmentManageProjectName || "项目"} 环境设置`);
  setText("environment-manage-summary", "");
  $("environment-manage-body").innerHTML = `
    <div class="modal-section">
      <div class="section-inline">
        <h3>环境列表</h3>
        <button class="small" data-action="open-managed-environment-form">新增环境</button>
      </div>
      <div class="table-wrap">
        <table class="data-table environment-table">
          <thead>
            <tr>
              <th>环境名称</th>
              <th>环境编码</th>
              <th>类型</th>
              <th>Base URL</th>
              <th>允许执行</th>
              <th>确认执行</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${renderEnvironmentManageRows()}</tbody>
        </table>
      </div>
    </div>`;
}

function renderEnvironmentFormModal() {
  const current = environmentFormValues();
  setText("environment-form-title", state.environmentEditingId ? "编辑环境" : "新增环境");
  $("environment-form-body").innerHTML = `
    <div class="project-form">
      <label>环境名称<input id="managed-environment-name" value="${escapeHtml(current.envName || "")}" placeholder="例如：测试环境" /></label>
      <label>环境编码<input id="managed-environment-code" value="${escapeHtml(current.envCode || "")}" placeholder="例如：test" /></label>
      <label>
        环境类型
        <select id="managed-environment-type">
          <option value="local" ${current.envType === "local" ? "selected" : ""}>本地</option>
          <option value="test" ${current.envType === "test" ? "selected" : ""}>测试</option>
          <option value="staging" ${current.envType === "staging" ? "selected" : ""}>预发</option>
          <option value="prod" ${current.envType === "prod" ? "selected" : ""}>生产</option>
        </select>
      </label>
      <label>Base URL<input id="managed-environment-base-url" value="${escapeHtml(current.baseUrl || "")}" placeholder="https://example.test" /></label>
      <label>环境说明<textarea id="managed-environment-desc" placeholder="环境说明">${escapeHtml(current.description || "")}</textarea></label>
      <div class="check-row">
        <label><input id="managed-environment-allow-execution" type="checkbox" ${current.allowExecution ? "checked" : ""} /> 允许执行</label>
        <label><input id="managed-environment-require-confirm" type="checkbox" ${current.requireConfirm ? "checked" : ""} /> 执行需确认</label>
      </div>
      <div class="actions">
        <button data-action="save-managed-environment">${state.environmentEditingId ? "保存环境" : "创建环境"}</button>
      </div>
    </div>`;
}

async function refreshEnvironmentManage(projectId) {
  state.projects = await api("/api/projects");
  renderProjects();
  state.environmentManageItems = await api(`/api/projects/${projectId}/environments`);
  if (Number(projectId) === Number(state.selectedProjectId)) {
    await loadEnvironments();
  }
  renderEnvironmentManageModal();
  renderSettings();
}

async function openEnvironmentManageModal(projectId, projectName = "") {
  state.environmentManageProjectId = Number(projectId);
  state.environmentManageProjectName =
    state.projects.find((item) => Number(item.id) === Number(projectId))?.projectName || projectName || "";
  state.environmentEditingId = 0;
  state.environmentManageItems = await api(`/api/projects/${projectId}/environments`);
  openModal("environment-manage-modal");
  renderEnvironmentManageModal();
}

function openManagedEnvironmentForm(environmentId = 0) {
  state.environmentEditingId = Number(environmentId || 0);
  renderEnvironmentFormModal();
  $("environment-form-modal")?.classList.remove("hidden");
}

function closeEnvironmentFormModal() {
  closeModal("environment-form-modal");
  state.environmentEditingId = 0;
}

function resetEnvironmentManageForm() {
  closeEnvironmentFormModal();
}

function editManagedEnvironment(environmentId) {
  openManagedEnvironmentForm(environmentId);
}

async function saveManagedEnvironment() {
  const projectId = Number(state.environmentManageProjectId || state.selectedProjectId);
  const payload = {
    envName: $("managed-environment-name").value.trim(),
    envCode: $("managed-environment-code").value.trim(),
    envType: $("managed-environment-type").value,
    baseUrl: $("managed-environment-base-url").value.trim(),
    description: $("managed-environment-desc").value.trim() || undefined,
    allowExecution: $("managed-environment-allow-execution").checked,
    requireConfirm: $("managed-environment-require-confirm").checked
  };
  if (!payload.envName || !payload.envCode || !payload.baseUrl) {
    throw new Error("请填写环境名称、环境编码和 Base URL");
  }
  if (state.environmentEditingId) {
    await api(`/api/projects/${projectId}/environments/${state.environmentEditingId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  } else {
    await api(`/api/projects/${projectId}/environments`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
  closeEnvironmentFormModal();
  await refreshEnvironmentManage(projectId);
}

async function deleteManagedEnvironment(environmentId) {
  const projectId = Number(state.environmentManageProjectId || state.selectedProjectId);
  const confirmed = await confirmAction({
    title: "删除环境",
    message: "确认删除该环境？",
    confirmText: "删除"
  });
  if (!confirmed) return;
  await api(`/api/projects/${projectId}/environments/${environmentId}`, {
    method: "DELETE"
  });
  await refreshEnvironmentManage(projectId);
}

function renderModuleManageRows() {
  return state.moduleManageItems.length
    ? state.moduleManageItems
        .map(
          (module) => `<tr>
            <td><strong>${escapeHtml(module.groupName || "")}</strong></td>
            <td>${escapeHtml(module.description || "-")}</td>
            <td>${renderActionMenu({
              detail: {
                label: "编辑",
                action: "open-project-module-form",
                attrs: `data-module-id="${module.id}"`
              },
              more: [
                {
                  label: "删除",
                  action: "delete-project-module",
                  attrs: `data-module-id="${module.id}"`,
                  variant: "danger"
                }
              ]
            })}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="3">暂无模块。</td></tr>`;
}

function renderModuleManageModal() {
  setText("module-manage-title", `${state.moduleManageProjectName || "项目"} 模块设置`);
  $("module-manage-body").innerHTML = `
    <div class="project-form">
      <div class="section-inline">
        <h3>模块枚举值</h3>
        <button class="small" data-action="open-project-module-form">新增模块</button>
      </div>
      <div class="table-wrap module-table-wrap">
        <table class="data-table module-table">
          <thead><tr><th>模块名称</th><th>说明</th><th>操作</th></tr></thead>
          <tbody>${renderModuleManageRows()}</tbody>
        </table>
      </div>
    </div>`;
}

async function openModuleManageModal(projectId, projectName = "") {
  state.moduleManageProjectId = Number(projectId);
  state.moduleManageProjectName =
    state.projects.find((item) => Number(item.id) === Number(projectId))?.projectName || projectName || "";
  state.moduleManageItems = await api(`/api/case-groups?projectId=${projectId}`);
  openModal("module-manage-modal");
  renderModuleManageModal();
}

async function refreshModuleManage() {
  const projectId = Number(state.moduleManageProjectId || state.selectedProjectId);
  state.moduleManageItems = await api(`/api/case-groups?projectId=${projectId}`);
  if (Number(projectId) === Number(state.selectedProjectId)) {
    await loadCases();
  }
  renderModuleManageModal();
  renderShell();
}

function renderModuleFormModal() {
  const current =
    state.moduleManageItems.find((item) => Number(item.id) === Number(state.moduleEditingId)) || {
      groupName: "",
      description: ""
    };
  setText("module-form-title", state.moduleEditingId ? "编辑模块" : "新增模块");
  $("module-form-body").innerHTML = `
    <div class="project-form">
      <label>模块名称<input id="module-form-name" value="${escapeHtml(current.groupName || "")}" placeholder="例如：登录模块" /></label>
      <label>说明<input id="module-form-desc" value="${escapeHtml(current.description || "")}" placeholder="模块说明" /></label>
      <div class="actions">
        <button data-action="save-project-module-form">${state.moduleEditingId ? "保存模块" : "创建模块"}</button>
      </div>
    </div>`;
}

function openModuleFormModal(groupId = 0) {
  state.moduleEditingId = Number(groupId || 0);
  renderModuleFormModal();
  $("module-form-modal")?.classList.remove("hidden");
}

function closeModuleFormModal() {
  closeModal("module-form-modal");
  state.moduleEditingId = 0;
}

async function saveProjectModuleForm() {
  const projectId = Number(state.moduleManageProjectId || state.selectedProjectId);
  const groupName = $("module-form-name").value.trim();
  const description = $("module-form-desc").value.trim();
  if (!groupName) {
    showNotice("请填写模块名称");
    return;
  }
  if (state.moduleEditingId) {
    await api(`/api/case-groups/${state.moduleEditingId}`, {
      method: "PATCH",
      body: JSON.stringify({ groupName, description })
    });
  } else {
    await api("/api/case-groups", {
      method: "POST",
      body: JSON.stringify({ projectId, groupName, description })
    });
  }
  closeModuleFormModal();
  await refreshModuleManage();
}

async function createProjectModule() {
  const projectId = Number(state.moduleManageProjectId || state.selectedProjectId);
  const groupName = $("new-module-name").value.trim();
  const description = $("new-module-desc").value.trim();
  if (!groupName) {
    showNotice("请填写模块名称");
    return;
  }
  await api("/api/case-groups", {
    method: "POST",
    body: JSON.stringify({ projectId, groupName, description })
  });
  await refreshModuleManage();
}

async function saveProjectModule(groupId) {
  const nameInput = document.querySelector(`[data-module-field="name"][data-module-id="${groupId}"]`);
  const descInput = document.querySelector(`[data-module-field="desc"][data-module-id="${groupId}"]`);
  const groupName = nameInput?.value?.trim() || "";
  const description = descInput?.value?.trim() || "";
  if (!groupName) {
    showNotice("请填写模块名称");
    return;
  }
  await api(`/api/case-groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify({ groupName, description })
  });
  await refreshModuleManage();
}

async function deleteProjectModule(groupId) {
  const confirmed = await confirmAction({
    title: "删除模块",
    message: "确认删除该模块？已有用例会自动改为未分组。",
    confirmText: "删除"
  });
  if (!confirmed) return;
  await api(`/api/case-groups/${groupId}`, { method: "DELETE" });
  await refreshModuleManage();
}

function checkedAttr(value) {
  return value ? "checked" : "";
}

function renderSettingsActionBar(saveAction, saveLabel, testAction, testLabel = "测试模型") {
  return `
    <div class="actions ai-config-actions">
      <button class="small" data-action="${saveAction}" ${canManageSettings() ? "" : "disabled"}>${saveLabel}</button>
      ${
        testAction
          ? `<button class="secondary small" data-action="${testAction}" ${canManageSettings() ? "" : "disabled"}>${testLabel}</button>`
          : ""
      }
    </div>`;
}

function renderStrategySettingsContent() {
  const settings = currentProjectSettings().execution;
  return `
    <div class="panel settings-sheet">
      ${renderSettingsActionBar("save-strategy-settings", "保存执行策略", null)}
      <div class="ai-config-grid">
        <div class="settings-span settings-note">这些默认值会自动带入“创建执行任务”弹窗。</div>
        <label>默认浏览器
          <select id="strategy-default-browser">
            <option value="chrome" ${settings.defaultBrowser === "chrome" ? "selected" : ""}>Chrome</option>
            <option value="edge" ${settings.defaultBrowser === "edge" ? "selected" : ""}>Edge</option>
            <option value="chromium" ${settings.defaultBrowser === "chromium" ? "selected" : ""}>Chromium</option>
          </select>
        </label>
        <label>默认重试次数<input id="strategy-default-retries" type="number" min="0" max="5" value="${escapeHtml(
          settings.defaultRetries
        )}" /></label>
        <label>默认超时(ms)<input id="strategy-default-timeout-ms" type="number" min="1000" max="300000" value="${escapeHtml(
          settings.defaultTimeoutMs
        )}" /></label>
        <label>报告保留天数<input id="strategy-report-retention-days" type="number" min="1" max="3650" value="${escapeHtml(
          settings.reportRetentionDays
        )}" /></label>
        <label>日志保留天数<input id="strategy-log-retention-days" type="number" min="1" max="3650" value="${escapeHtml(
          settings.logRetentionDays
        )}" /></label>
        <div class="settings-span settings-note">
          生产执行权限仍然由环境配置控制，当前状态：${
            state.environments.some((environment) => environment.envType === "prod" && environment.allowExecution)
              ? "已允许生产环境执行"
              : "需在环境管理中单独开启"
          }。
        </div>
        <label class="checkline"><input id="strategy-default-headless" type="checkbox" ${checkedAttr(settings.defaultHeadless)} />默认 headless</label>
        <div class="settings-span settings-note">执行任务默认开启截图和视频，不再记录 Trace。</div>
      </div>
    </div>`;
}

function renderAgentSettingsContent() {
  const settings = currentProjectSettings().agent;
  return `
    <div class="panel settings-sheet">
      ${renderSettingsActionBar("save-agent-settings", "保存 Agent 配置", "check-agent-settings", "检测 Agent")}
      <div class="ai-config-grid">
        <div class="settings-span settings-note">保存后会同步到录制页顶部的 Agent 地址，录制和健康检查都会直接使用这里的配置。</div>
        <label>Agent Base URL<input id="agent-settings-base-url" value="${escapeHtml(settings.baseUrl)}" placeholder="http://127.0.0.1:37665" /></label>
        <label>健康检查路径<input id="agent-settings-health-path" value="${escapeHtml(settings.healthPath)}" placeholder="/health" /></label>
        <div class="settings-span settings-note">当前连接状态：${escapeHtml(state.agentStatus || "未检测")}</div>
        <label class="checkline"><input id="agent-settings-check-before-recording" type="checkbox" ${checkedAttr(
          settings.checkBeforeRecording !== false
        )} />录制前先检测 Agent</label>
        <label class="checkline"><input id="agent-settings-auto-check-on-load" type="checkbox" ${checkedAttr(
          settings.autoCheckOnLoad !== false
        )} />页面加载后自动检测 Agent</label>
      </div>
    </div>`;
}

function renderAiHealingConfigContent() {
  const config = state.projectAiConfig || {};
  return `
    <div class="panel settings-sheet">
      ${renderSettingsActionBar("save-ai-healing", "保存自愈配置", "test-ai-healing")}
      <div class="ai-config-grid">
        <div class="settings-span settings-note">这里配置的是 Locator 自愈与通用 AI 执行策略。视觉定位、验证码识别会在各自页签里独立配置。</div>
      <label class="checkline"><input id="ai-enable-fallback" type="checkbox" ${checkedAttr(config.enableLocatorFallback !== false)} />启用候选 Locator 回退</label>
        <label class="checkline"><input id="ai-enable-healing" type="checkbox" ${checkedAttr(config.enableAiHealing)} />启用 AI 自愈定位</label>
        <label class="checkline"><input id="ai-auto-promote" type="checkbox" ${checkedAttr(config.autoPromoteHealedLocator)} />命中后自动写回元素库</label>
        <label class="checkline"><input id="ai-manual-review" type="checkbox" ${checkedAttr(config.requireManualReview !== false)} />需要人工审核</label>
        <label class="checkline"><input id="ai-allow-prod" type="checkbox" ${checkedAttr(config.allowAiOnProd)} />允许生产环境调用 AI</label>
        <label>Provider<input id="ai-provider" value="${escapeHtml(config.aiProvider || "openai-compatible")}" /></label>
        <label>Model<input id="ai-model" value="${escapeHtml(config.aiModel || "")}" placeholder="例如 gpt-4.1-mini / qwen-vl-plus" /></label>
        <label>Base URL<input id="ai-base-url" value="${escapeHtml(config.aiBaseUrl || "")}" placeholder="https://api.example.com/v1" /></label>
        <label>API Key<input id="ai-api-key" type="password" placeholder="${config.hasApiKey ? "已保存，留空不修改" : "请输入 API Key"}" /></label>
        <label>超时(ms)<input id="ai-timeout-ms" type="number" min="1000" max="120000" value="${escapeHtml(config.aiTimeoutMs || 20000)}" /></label>
        <label>最大 AI 尝试次数<input id="ai-max-attempts" type="number" min="1" max="5" value="${escapeHtml(config.maxAiAttempts || 1)}" /></label>
        <label>AI Locator 置信度阈值<input id="ai-locator-confidence-threshold" type="number" min="0" max="100" step="1" value="${escapeHtml(
          config.aiLocatorConfidenceThreshold ?? 70
        )}" /></label>
      </div>
    </div>`;
}

function renderAiVisualConfigContent() {
  const config = state.projectAiConfig || {};
  return `
    <div class="panel settings-sheet">
      ${renderSettingsActionBar("save-ai-visual", "保存视觉定位配置", "test-ai-visual")}
      <div class="ai-config-grid">
        <div class="settings-span settings-note">视觉定位使用独立模型配置；模型、Base URL 或 API Key 留空时，会自动回退到“AI 自愈定位”页的模型接入。</div>
        <label class="checkline"><input id="ai-enable-visual-locator" type="checkbox" ${checkedAttr(
          config.enableAiVisualLocator
        )} />启用 AI 视觉定位</label>
        <label>视觉定位引擎<input id="ai-visual-provider" value="${escapeHtml(
          config.aiVisualProvider || "midscene"
        )}" placeholder="默认 midscene" /></label>
        <label>视觉模型族<input id="ai-visual-model-family" value="${escapeHtml(
          config.aiVisualModelFamily || ""
        )}" placeholder="例如 qwen3-vl / qwen3.5 / glm-v / gpt-5" /></label>
        <label>视觉 Model<input id="ai-visual-model" value="${escapeHtml(
          config.aiVisualModel || ""
        )}" placeholder="留空则继承自愈模型" /></label>
        <label>视觉 Base URL<input id="ai-visual-base-url" value="${escapeHtml(
          config.aiVisualBaseUrl || ""
        )}" placeholder="留空则继承自愈 Base URL" /></label>
        <label>视觉 API Key<input id="ai-visual-api-key" type="password" placeholder="${
          config.aiVisualHasApiKey ? "已保存专用 Key，留空不修改" : "留空则继承自愈 API Key"
        }" /></label>
        <label>视觉定位超时(ms)<input id="ai-visual-timeout-ms" type="number" min="1000" max="120000" value="${escapeHtml(
          config.aiVisualTimeoutMs || 15000
        )}" /></label>
        <label>视觉定位最大尝试次数<input id="ai-visual-max-attempts" type="number" min="1" max="3" value="${escapeHtml(
          config.aiVisualMaxAttempts || 1
        )}" /></label>
      </div>
    </div>`;
}

function renderAiCaptchaConfigContent() {
  const config = state.projectAiConfig || {};
  return `
    <div class="panel settings-sheet">
      ${renderSettingsActionBar("save-ai-captcha", "保存验证码配置", "test-ai-captcha")}
      <div class="ai-config-grid">
        <div class="settings-span settings-note">验证码识别支持单独模型接入；留空时会继承自愈定位页的模型配置。</div>
        <label class="checkline"><input id="ai-enable-captcha" type="checkbox" ${checkedAttr(config.enableAiCaptcha)} />启用 AI 验证码识别</label>
        <label>Provider<input id="ai-captcha-provider" value="${escapeHtml(
          config.aiCaptchaProvider || ""
        )}" placeholder="留空则继承自愈 Provider" /></label>
        <label>Model<input id="ai-captcha-model" value="${escapeHtml(
          config.aiCaptchaModel || ""
        )}" placeholder="留空则继承自愈 Model" /></label>
        <label>Base URL<input id="ai-captcha-base-url" value="${escapeHtml(
          config.aiCaptchaBaseUrl || ""
        )}" placeholder="留空则继承自愈 Base URL" /></label>
        <label>API Key<input id="ai-captcha-api-key" type="password" placeholder="${
          config.aiCaptchaHasApiKey ? "已保存专用 Key，留空不修改" : "留空则继承自愈 API Key"
        }" /></label>
        <label>超时(ms)<input id="ai-captcha-timeout-ms" type="number" min="1000" max="120000" value="${escapeHtml(
          config.aiCaptchaTimeoutMs || 20000
        )}" /></label>
        <label>验证码置信度阈值<input id="captcha-confidence-threshold" type="number" min="0" max="100" step="1" value="${escapeHtml(
          config.captchaConfidenceThreshold ?? 80
        )}" /></label>
        <label>验证码最大重试次数<input id="captcha-max-attempts" type="number" min="1" max="5" value="${escapeHtml(
          config.captchaMaxAttempts || 3
        )}" /></label>
      </div>
    </div>`;
}

function parseJsonMaybe(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatLocatorValue(locator) {
  const record = parseJsonMaybe(locator, {});
  const type = record.locatorType || record.type || "-";
  const value = record.locatorValue || record.value || "";
  return `${type} ${value}`.trim();
}

function renderAiHealLogRow(log) {
  const selectedLocator = formatLocatorValue(log.selectedLocator);
  const oldLocator = formatLocatorValue(log.oldLocator);
  return `<tr>
    <td>${fmt(log.createdAt)}</td>
    <td>${escapeHtml(log.action || "-")}</td>
    <td class="cell-url">${escapeHtml(log.pageTitle || log.pageUrl || "-")}</td>
    <td class="cell-url">${escapeHtml(oldLocator || "-")}</td>
    <td class="cell-url">${escapeHtml(selectedLocator || "-")}</td>
    <td>${log.confidence ?? "-"}</td>
    <td>${badge(log.status)}</td>
    <td>${renderActionMenu({
      more: [
        {
          label: "应用",
          action: "apply-ai-heal-log",
          attrs: `data-log-id="${log.id}"`,
          disabled: ["applied", "rejected", "failed"].includes(log.status)
        },
        {
          label: "拒绝",
          action: "reject-ai-heal-log",
          attrs: `data-log-id="${log.id}"`,
          disabled: ["applied", "rejected"].includes(log.status),
          variant: "danger"
        }
      ]
    })}</td>
  </tr>`;
}

function renderAiHealLogsContent() {
  return `
    <div class="panel settings-sheet">
      <div class="toolbar compact-toolbar">
        <label>关键字<input id="ai-heal-keyword" placeholder="页面 / 动作 / 原因" value="${escapeHtml($("ai-heal-keyword")?.value || "")}" /></label>
        <label>状态
          <select id="ai-heal-status">
            ${["", "verified", "applied", "rejected", "rejected_by_confidence", "visual_failed", "failed"]
              .map((status) => `<option value="${status}" ${($("ai-heal-status")?.value || "") === status ? "selected" : ""}>${status ? statusLabel(status) : "全部状态"}</option>`)
              .join("")}
          </select>
        </label>
        <button class="secondary small" data-action="search-ai-heal-logs">查询</button>
        <button class="secondary small" data-action="reset-ai-heal-logs">重置</button>
      </div>
      ${
        state.aiHealLogs.length
          ? renderPagedTable({
              key: "aiHealLog",
              page: state.aiHealLogPage,
              total: state.aiHealLogTotal,
              totalPages: state.aiHealLogTotalPages,
              tableHtml: `<table class="data-table ai-heal-table">
                <thead><tr><th>时间</th><th>动作</th><th>页面</th><th>原 Locator</th><th>AI Locator</th><th>置信度</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>${state.aiHealLogs.map(renderAiHealLogRow).join("")}</tbody>
              </table>`
            })
          : `<div class="empty-state">暂无 AI 自愈日志。</div>`
      }
    </div>`;
}

function renderSettings() {
  const projectKeyword = $("settings-project-keyword")?.value?.trim().toLowerCase() || "";
  const projectStatus = $("settings-project-status")?.value || "";
  const filteredProjects = state.projects.filter((project) => {
    const normalizedStatus = Number(project.status) === 1 || project.status === "active" ? "active" : "disabled";
    if (projectStatus && normalizedStatus !== projectStatus) return false;
    if (!projectKeyword) return true;
    return [project.projectName, project.projectCode, roleNames[project.projectRole] || project.projectRole]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(projectKeyword));
  });
  const projectPagination = paginate(filteredProjects, state.projectPage, state.projectPageSize);
  state.projectPage = projectPagination.page;
  const tab = state.settingsTab === "ai" ? "aiHealing" : state.settingsTab || "projects";
  if (tab !== state.settingsTab) {
    state.settingsTab = tab;
    localStorage.setItem("tp_settings_tab", tab);
  }
  const projectContent = `
    <div class="panel settings-sheet">
      <div class="toolbar compact-toolbar">
        <label>
          关键字
          <input id="settings-project-keyword" placeholder="项目名称 / 编码 / 角色" value="${escapeHtml(
            $("settings-project-keyword")?.value || ""
          )}" />
        </label>
        <label>
          状态
          <select id="settings-project-status">
            <option value="" ${!projectStatus ? "selected" : ""}>全部状态</option>
            <option value="active" ${projectStatus === "active" ? "selected" : ""}>启用</option>
            <option value="disabled" ${projectStatus === "disabled" ? "selected" : ""}>禁用</option>
          </select>
        </label>
        <button id="settings-search-button" class="secondary small">查询</button>
        <button id="settings-reset-button" class="secondary small">重置</button>
        <div class="toolbar-spacer"></div>
        <button id="open-project-modal-button" data-action="open-project-modal" class="small" ${canCreateProject() ? "" : "disabled"}>新建项目</button>
      </div>
      ${
        filteredProjects.length
          ? renderPagedTable({
              key: "project",
              page: projectPagination.page,
              total: projectPagination.total,
              totalPages: projectPagination.totalPages,
              tableHtml: renderProjectTable(projectPagination.items)
            })
          : `<div class="empty-state">暂无可访问项目。</div>`
      }
    </div>`;
  const contentByTab = {
    projects: projectContent,
    strategy: renderStrategySettingsContent(),
    agent: renderAgentSettingsContent(),
    aiHealing: renderAiHealingConfigContent(),
    aiVisual: renderAiVisualConfigContent(),
    aiCaptcha: renderAiCaptchaConfigContent(),
    aiLogs: renderAiHealLogsContent()
  };
  $("settings-panel").innerHTML = `
    <div class="settings-tabs">
      <button class="settings-tab ${tab === "projects" ? "active" : ""}" data-action="settings-tab" data-tab="projects">项目设置</button>
      <button class="settings-tab ${tab === "strategy" ? "active" : ""}" data-action="settings-tab" data-tab="strategy">执行策略</button>
      <button class="settings-tab ${tab === "agent" ? "active" : ""}" data-action="settings-tab" data-tab="agent">Agent 配置</button>
      <button class="settings-tab ${tab === "aiHealing" ? "active" : ""}" data-action="settings-tab" data-tab="aiHealing">AI 自愈定位</button>
      <button class="settings-tab ${tab === "aiVisual" ? "active" : ""}" data-action="settings-tab" data-tab="aiVisual">AI 视觉定位</button>
      <button class="settings-tab ${tab === "aiCaptcha" ? "active" : ""}" data-action="settings-tab" data-tab="aiCaptcha">AI 验证码识别</button>
      <button class="settings-tab ${tab === "aiLogs" ? "active" : ""}" data-action="settings-tab" data-tab="aiLogs">AI 自愈日志</button>
    </div>
    ${contentByTab[tab] || projectContent}`;
}
async function checkAgent(silent = false) {
  const response = await fetch(`${agentBaseUrl()}${agentHealthPath()}`);
  const payload = await response.json();
  if (!response.ok || payload.code >= 400) {
    setAgentStatus("离线");
    throw new Error(payload.message || "Agent 不可用");
  }
  const sessions = payload.data.sessions || [];
  if (state.activeRecordingSession && !sessions.includes(state.activeRecordingSession)) {
    state.activeRecordingSession = "";
    localStorage.removeItem("tp_active_recording");
  }
  syncRecordingButtons();
  setAgentStatus(`在线 ${payload.data.activeSessions}`);
  if (!silent) {
    setAgentMessage(`Agent 在线，活动会话 ${payload.data.activeSessions}`);
  }
}

async function startRecording(autoDemo = false) {
  if (!state.token) {
    throw new Error("请先登录平台");
  }
  if (currentProjectSettings().agent.checkBeforeRecording !== false) {
    await checkAgent(true);
  }
  const response = await fetch(`${agentBaseUrl()}/start-recording`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      apiBaseUrl: window.location.origin,
      token: state.token,
      projectId: Number(state.selectedProjectId),
      environmentId: state.selectedEnvironmentId || state.environments[0]?.id || 1,
      startUrl: $("recording-url").value.trim(),
      browser: $("recording-browser").value,
      mode: "record",
      headless: autoDemo,
      autoDemo
    })
  });
  const payload = await response.json();
  if (!response.ok || payload.code >= 400) {
    throw new Error(payload.message || "启动录制失败");
  }
  setAgentMessage(`录制已启动：${payload.data.sessionNo}`);
  state.activeRecordingSession = payload.data.sessionNo;
  localStorage.setItem("tp_active_recording", state.activeRecordingSession);
  syncRecordingButtons();
  setTimeout(() => loadProjectData().catch(console.error), autoDemo ? 2500 : 800);
}

async function stopRecording() {
  if (!state.activeRecordingSession) {
    setAgentMessage("当前没有活动录制会话");
    return;
  }
  const sessionNo = state.activeRecordingSession;
  const response = await fetch(`${agentBaseUrl()}/recordings/${encodeURIComponent(sessionNo)}/stop`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      apiBaseUrl: window.location.origin,
      token: state.token
    })
  });
  const payload = await response.json();
  if (!response.ok || payload.code >= 400) {
    throw new Error(payload.message || "停止录制失败");
  }
  state.activeRecordingSession = "";
  localStorage.removeItem("tp_active_recording");
  syncRecordingButtons();
  setAgentMessage(`录制已停止：${sessionNo}`);
  await loadProjectData();
}

function syncRecordingButtons() {
  const hasActive = Boolean(state.activeRecordingSession);
  $("stop-recording-button").disabled = !hasActive;
  $("start-recording-button").disabled = hasActive;
}

async function materialize(sessionNo) {
  const suffix = sessionNo.slice(-8);
  openMaterializeNotice({
    title: "正在生成用例",
    summary: `会话 ${sessionNo}`,
    message: "元素正在生成中，请稍后在元素库中查看。"
  });
  try {
    const data = await api(`/api/recording-sessions/${encodeURIComponent(sessionNo)}/materialize`, {
      method: "POST",
      body: JSON.stringify({
        pageName: `录制页面 ${suffix}`,
        caseName: `录制用例 ${suffix}`,
        caseCode: `REC_${suffix.toUpperCase()}`
      })
    });
    await loadProjectData();
    openMaterializeNotice({
      title: "生成完成",
      summary: `会话 ${sessionNo}`,
      message: `已生成用例，元素 ${data.elementCount || 0} 个（去重后数量）`
    });
  } catch (error) {
    openMaterializeNotice({
      title: "生成失败",
      summary: `会话 ${sessionNo}`,
      message: error.message || String(error)
    });
  }
}

async function showRecordingEvents(sessionNo) {
  state.recordingEventSession = sessionNo;
  state.recordingEventPage = Math.max(1, Number(state.recordingEventPage) || 1);
  const query = new URLSearchParams({
    page: String(state.recordingEventPage),
    pageSize: String(state.recordingEventPageSize)
  });
  const data = await api(`/api/recording-sessions/${encodeURIComponent(sessionNo)}/events?${query.toString()}`);
  const events = data.items || [];
  openModal("recording-event-modal");
  setText("recording-event-title", `录制事件详情：${sessionNo}`);
  setText("recording-event-summary", `共 ${data.total} 条事件，第 ${data.page} / ${data.totalPages} 页`);
  if (!events.length) {
    $("recording-event-body").innerHTML = `<div class="empty-state">该录制会话暂无事件。</div>`;
    return;
  }
  $("recording-event-body").innerHTML = `
    <table class="data-table event-table">
      <thead><tr><th>#</th><th>事件</th><th>动作</th><th>URL</th><th>输入</th><th>时间</th></tr></thead>
      <tbody>
        ${events
          .map(
            (event) => `<tr>
              <td>${event.eventOrder}</td>
              <td>${escapeHtml(event.eventType)}</td>
              <td>${escapeHtml(event.action || "-")}</td>
              <td>${escapeHtml(event.url || "-")}</td>
              <td>${escapeHtml(event.inputValueMasked || "-")}</td>
              <td>${fmt(event.eventTime || event.createdAt)}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <div class="pagination">
      <button class="secondary" data-action="recording-events-page" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>上一页</button>
      <span>第 ${data.page} / ${data.totalPages} 页</span>
      <button class="secondary" data-action="recording-events-page" data-page="${data.page + 1}" ${data.page >= data.totalPages ? "disabled" : ""}>下一页</button>
    </div>`;
}

function closeRecordingEvents() {
  closeModal("recording-event-modal");
  $("recording-event-body").innerHTML = "";
  setText("recording-event-summary", "");
}

function openMaterializeNotice({ title, summary = "", message = "" }) {
  setText("materialize-notice-title", title || "生成用例");
  setText("materialize-notice-summary", summary);
  setText("materialize-notice-message", message);
  if (state.currentModal && state.currentModal !== "materialize-notice-modal") {
    closeCurrentModal();
  }
  $("materialize-notice-modal")?.classList.remove("hidden");
  state.currentModal = "materialize-notice-modal";
}

function closeMaterializeNotice() {
  closeModal("materialize-notice-modal");
  setText("materialize-notice-summary", "");
  setText("materialize-notice-message", "");
}

async function deleteRecording(sessionNo) {
  const confirmed = await confirmAction({
    title: "删除录制会话",
    message: `确认删除录制会话 ${sessionNo}？删除后不可恢复。`,
    confirmText: "删除"
  });
  if (!confirmed) {
    return;
  }
  await api(`/api/recording-sessions/${encodeURIComponent(sessionNo)}`, {
    method: "DELETE"
  });
  closeRecordingEvents();
  await loadProjectData();
}

function elementPageChoices() {
  const pages = new Map();
  for (const item of state.elementTree || []) {
    const pageId = item.pageId ? String(item.pageId) : "";
    const pageName = item.pageName || "未分组页面";
    if (!pages.has(pageId)) {
      pages.set(pageId, pageName);
    }
  }
  for (const item of state.elements || []) {
    const pageId = item.pageId ? String(item.pageId) : "";
    const pageName = item.pageName || "未分组页面";
    if (!pages.has(pageId)) {
      pages.set(pageId, pageName);
    }
  }
  return [{ value: "", label: "未分组页面" }, ...Array.from(pages.entries()).map(([value, label]) => ({ value, label }))];
}

function elementComponentChoices(pageId = "") {
  const components = new Map();
  for (const item of state.elementTree || []) {
    const matchesPage = pageId ? String(item.pageId || "") === String(pageId) : !item.pageId;
    if (!matchesPage) continue;
    const componentId = item.componentId ? String(item.componentId) : "";
    const componentName = item.componentName || "未分组组件";
    if (!components.has(componentId)) {
      components.set(componentId, componentName);
    }
  }
  for (const item of state.elements || []) {
    const matchesPage = pageId ? String(item.pageId || "") === String(pageId) : !item.pageId;
    if (!matchesPage) continue;
    const componentId = item.componentId ? String(item.componentId) : "";
    const componentName = item.componentName || "未分组组件";
    if (!components.has(componentId)) {
      components.set(componentId, componentName);
    }
  }
  return [{ value: "", label: "未分组组件" }, ...Array.from(components.entries()).map(([value, label]) => ({ value, label }))];
}

function renderOptionList(options, selectedValue = "") {
  return options
    .map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selectedValue) ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
    .join("");
}

function renderElementToolbarHtml() {
  return `
    <label>
      关键字
      <input id="element-keyword" placeholder="搜索元素名称" />
    </label>
    <label>
      有效状态
      <select id="element-valid-filter">
        <option value="">全部状态</option>
        <option value="1">有效</option>
        <option value="0">无效</option>
      </select>
    </label>
    <button id="element-search-button" class="secondary small">查询</button>
    <button id="element-reset-button" class="secondary small">重置</button>
    <div class="toolbar-spacer"></div>
    <button id="new-element-button" class="small">新增元素</button>
  `;
}

function ensureElementToolbarLayout() {
  const panel = document.querySelector(".element-list-panel");
  if (!(panel instanceof HTMLElement)) return;
  const toolbar = panel.querySelector(".toolbar.compact-toolbar");
  if (toolbar instanceof HTMLElement && toolbar.dataset.initialized !== "1") {
    toolbar.classList.add("element-filter-toolbar");
    toolbar.innerHTML = renderElementToolbarHtml();
    toolbar.dataset.initialized = "1";
  }
  const extraToolbar = panel.querySelector(".element-create-toolbar");
  extraToolbar?.remove();
}

function ensureLocatorFormModal() {
  if ($("locator-form-modal")) {
    return;
  }
  const container = document.createElement("section");
  container.id = "locator-form-modal";
  container.className = "modal-backdrop hidden locator-form-modal";
  container.setAttribute("aria-modal", "true");
  container.setAttribute("role", "dialog");
  container.innerHTML = `
    <div class="modal-page modal-page-narrow">
      <div class="modal-head">
        <div>
          <p class="eyebrow">Locator</p>
          <h2 id="locator-form-title">新增 Locator</h2>
          <p id="locator-form-summary" class="meta">维护 Locator 的类型、定位值，表达式会自动生成。</p>
        </div>
        <button id="locator-form-close" class="secondary">关闭</button>
      </div>
      <div class="detail">
        <div class="project-form locator-form-grid">
          <label>Locator 类型<select id="locator-form-type">${renderLocatorTypeOptions("css")}</select></label>
          <label>Locator 值<input id="locator-form-value" placeholder="请输入 Locator 值" /></label>
          <label>表达式<input id="locator-form-expression" placeholder="自动生成" readonly /></label>
          <label class="checkline locator-primary-inline"><input id="locator-form-primary" type="checkbox" />设为主定位</label>
        </div>
        <div class="actions">
          <button id="locator-form-save">新增 Locator</button>
          <button id="locator-form-cancel" class="secondary">取消</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(container);
}

function renderLocatorTypeOptions(selectedValue = "css") {
  return elementLocatorTypeOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selectedValue) ? "selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");
}

function appendElementLocatorRow(locator = {}) {
  const tbody = $("element-locator-editor-body");
  if (!tbody) return;
  const locatorExpression = buildElementLocatorExpression(locator.locatorType || "css", locator.locatorValue || "");
  const rowHtml = `<tr
      data-locator-id="${locator.id || ""}"
      data-source="${escapeHtml(locator.source || "manual")}"
      data-status="${escapeHtml(locator.status || "active")}"
      data-score="${Number(locator.score ?? 80)}"
      data-confidence="${Number(locator.confidence ?? locator?.score ?? 80)}"
      data-success-count="${Number(locator.successCount || 0)}"
      data-failed-count="${Number(locator.failedCount || 0)}"
      data-is-unique="${locator.isUnique ? "1" : "0"}"
      data-is-visible="${locator.isVisible ? "1" : "0"}"
      data-is-actionable="${locator.isActionable ? "1" : "0"}">
      <td><label class="locator-primary-check"><input type="radio" name="element-primary-locator" data-field="locatorPrimary" ${locator.isPrimary ? "checked" : ""} /></label></td>
      <td><select data-field="locatorType">${renderLocatorTypeOptions(locator.locatorType || "css")}</select></td>
<td><input data-field="locatorValue" value="${escapeHtml(locator.locatorValue || "")}" placeholder="请输入 Locator 值" /></td>
      <td><input data-field="locatorExpression" value="${escapeHtml(locatorExpression)}" placeholder="自动生成" readonly /></td>
      <td>${escapeHtml(locator.source || "manual")}</td>
      <td>${badge(locator.status || "active")}</td>
      <td>${Number(locator.successCount || 0)} / ${Number(locator.failedCount || 0)}</td>
      <td>
        <div class="table-actions compact-actions">
          <button class="small secondary" data-action="save-element-locator-row">保存</button>
          <button class="small danger" data-action="remove-element-locator-row">删除</button>
        </div>
      </td>
    </tr>`;
  tbody.insertAdjacentHTML("beforeend", rowHtml);
}

function syncElementComponentOptions(preferredValue = "") {
  const pageId = $("edit-element-page")?.value || "";
  const componentSelect = $("edit-element-component");
  if (!(componentSelect instanceof HTMLSelectElement)) return;
  componentSelect.innerHTML = renderOptionList(elementComponentChoices(pageId), preferredValue);
}

function readElementLocatorRows() {
  return Array.from(document.querySelectorAll("#element-locator-editor-body tr")).map((row, index) => {
    const locatorType = row.querySelector('[data-field="locatorType"]')?.value?.trim() || "";
    const locatorValue = row.querySelector('[data-field="locatorValue"]')?.value?.trim() || "";
    const locatorExpression = buildElementLocatorExpression(locatorType, locatorValue);
    return {
      id: Number(row.dataset.locatorId || 0) || undefined,
      locatorType,
      locatorValue,
      locatorExpression,
      isPrimary: Boolean(row.querySelector('[data-field="locatorPrimary"]')?.checked),
      source: row.dataset.source || "manual",
      status: row.dataset.status || "active",
      score: Number(row.dataset.score || 80),
      confidence: Number(row.dataset.confidence || row.dataset.score || 80),
      priority: index + 1,
      isUnique: row.dataset.isUnique === "1",
      isVisible: row.dataset.isVisible === "1",
      isActionable: row.dataset.isActionable === "1"
    };
  });
}

function primaryLocatorSummary(locators) {
  const primary = Array.isArray(locators) ? locators.find((item) => item.isPrimary) : null;
  if (!primary) {
    return "-";
  }
  const type = String(primary.locatorType || "-");
  const value = String(primary.locatorValue || "");
  return value ? `${type} / ${value}` : type;
}

function renderElementDetailForm(element, mode = "edit") {
  const pageId =
    element.pageId || (mode === "create" && state.selectedElementPageId !== "all" && state.selectedElementPageId !== "-1"
      ? Number(state.selectedElementPageId)
      : "");
  const locators = Array.isArray(element.locators) ? element.locators : [];
  const references = (element.references || [])
    .map(
      (testCase) => `<tr>
        <td>${escapeHtml(testCase.caseName)}</td>
        <td>${escapeHtml(testCase.caseCode || "-")}</td>
        <td>${escapeHtml(testCase.priority || "-")}</td>
        <td>${badge(testCase.status === 1 ? "active" : "disabled")}</td>
      </tr>`
    )
    .join("");
  const detailTitle = mode === "create" ? "新增元素" : "元素信息";
  const metaRows = [
    { label: "创建人", value: escapeHtml(element.createdByName || "-"), isHtml: true },
    { label: "主 Locator", value: escapeHtml(primaryLocatorSummary(locators)), isHtml: true },
    { label: "最近错误", value: escapeHtml(element.lastError || "-"), isHtml: true, className: "settings-break" }
  ];

  $("element-detail-body").innerHTML = `
    <section class="element-info-card modal-section">
      <div class="section-inline">
        <h3>${detailTitle}</h3>
        <div class="actions locator-inline-actions">
          <button data-action="save-element">${mode === "create" ? "创建元素" : "保存元素"}</button>
          ${mode === "edit" ? `<button class="danger" data-action="disable-element" data-element-id="${element.id}">删除元素</button>` : ""}
        </div>
      </div>
      <div class="element-detail-layout">
        <div class="project-form element-detail-form">
          <label>页面<select id="edit-element-page">${renderOptionList(elementPageChoices(), String(pageId || ""))}</select></label>
          <label>组件<select id="edit-element-component"></select></label>
          <label>元素名称<input id="edit-element-name" value="${escapeHtml(element.elementName || "")}" /></label>
          <label>有效状态
            <select id="edit-element-valid-status">
              ${renderOptionList(
                [
                  { value: "1", label: "有效" },
                  { value: "0", label: "无效" }
                ],
                String(Number(element.validStatus) === 1 ? 1 : 0)
              )}
            </select>
          </label>
          <label>元素类型
            <select id="edit-element-type">
              ${renderOptionList(
                [
                  { value: "", label: "未指定" },
                  { value: "input", label: "input" },
                  { value: "password", label: "password" },
                  { value: "button", label: "button" },
                  { value: "select", label: "select" },
                  { value: "text", label: "text" }
                ],
                element.elementType || ""
              )}
            </select>
          </label>
          <label>默认动作
            <select id="edit-element-action">
              ${renderOptionList(
                [
                  { value: "", label: "未指定" },
                  { value: "click", label: "click" },
                  { value: "fill", label: "fill" },
                  { value: "select", label: "select" },
                  { value: "assert", label: "assert" }
                ],
                element.defaultAction || ""
              )}
            </select>
          </label>
          <label>来源 URL<input id="edit-element-source-url" value="${escapeHtml(element.sourceUrl || "")}" placeholder="https://example.com/login" /></label>
        </div>
        <div class="settings-list element-meta-list">
          ${metaRows
            .map(
              (item) => `<div class="settings-row ${item.className || ""}">
                <span>${item.label}</span>
                <strong ${item.label === "最近错误" ? `title="${escapeHtml(element.lastError || "-")}"` : ""}>${item.isHtml ? item.value : escapeHtml(item.value || "-")}</strong>
              </div>`
            )
            .join("")}
        </div>
      </div>
    </section>
    <div class="section-inline">
<h3>Locator 列表</h3>
      <div class="actions locator-inline-actions">
<button class="secondary small" data-action="add-element-locator">新增 Locator</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table element-locator-table">
        <thead><tr><th>主</th><th>方式</th><th>定位值</th><th>表达式</th><th>来源</th><th>状态</th><th>成功/失败</th><th>操作</th></tr></thead>
        <tbody id="element-locator-editor-body"></tbody>
      </table>
    </div>
    ${
      mode === "edit"
        ? `<h3>引用用例</h3>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>用例名称</th><th>用例编码</th><th>优先级</th><th>状态</th></tr></thead>
        <tbody>${references || `<tr><td colspan="4">暂无引用用例。</td></tr>`}</tbody>
      </table>
    </div>`
        : ""
    }`;

  syncElementComponentOptions(String(element.componentId || ""));
  if (locators.length) {
    locators.forEach((locator) => appendElementLocatorRow(locator));
  } else {
    appendElementLocatorRow({ isPrimary: true, source: "manual", status: "active", score: 80, confidence: 80 });
  }
  refreshTableCellTitles($("element-detail-body"));
}

function showNewElementForm() {
  state.currentElementId = 0;
  state.currentElementMode = "create";
  openModal("element-detail-modal");
  setText("element-detail-title", "新增元素");
  setText("element-detail-summary", "支持手动维护元素基础信息；Locator 表达式会根据方式和定位值自动生成。");
  renderElementDetailForm(
    {
      pageId: state.selectedElementPageId !== "all" && state.selectedElementPageId !== "-1" ? Number(state.selectedElementPageId) : "",
      componentId: "",
      elementName: "",
      validStatus: 0,
      elementType: "",
      defaultAction: "",
      sourceUrl: "",
      locators: []
    },
    "create"
  );
}

async function showElementDetail(elementId) {
  const element = await api(`/api/elements/${elementId}`);
  state.currentElementId = Number(elementId);
  state.currentElementMode = "edit";
  openModal("element-detail-modal");
  setText("element-detail-title", `元素信息：${element.elementName}`);
  setText("element-detail-summary", `${element.pageName || "未分组页面"} / ${element.componentName || "未分组组件"} / ${(element.locators || []).length} 个 Locator`);
  renderElementDetailForm(element, "edit");
}

function openLocatorFormModal() {
  ensureLocatorFormModal();
  $("locator-form-title").textContent = "新增 Locator";
  $("locator-form-summary").textContent = "填写 Locator 类型和定位值后，系统将自动生成表达式并添加至 Locator 列表。";
  $("locator-form-type").value = "css";
  $("locator-form-value").value = "";
  $("locator-form-expression").value = "";
  $("locator-form-primary").checked = false;
  syncLocatorFormExpression();
  $("locator-form-modal")?.classList.remove("hidden");
  requestAnimationFrame(() => $("locator-form-value")?.focus());
}

function closeLocatorFormModal() {
  $("locator-form-modal")?.classList.add("hidden");
  if ($("locator-form-value")) $("locator-form-value").value = "";
  if ($("locator-form-expression")) $("locator-form-expression").value = "";
  if ($("locator-form-primary")) $("locator-form-primary").checked = false;
}

function closeElementDetail() {
  closeLocatorFormModal();
  closeModal("element-detail-modal");
  $("element-detail-body").innerHTML = "";
  setText("element-detail-summary", "");
  state.currentElementId = 0;
  state.currentElementMode = "edit";
}

function openTreeNodeRenameModal(type, id, currentName, pageId = "", isVirtual = false) {
  const labelMap = {
    page: "页面",
    component: "组件",
    element: "元素"
  };
  const nodeLabel = labelMap[type] || "节点";
  state.treeNodeEditType = type || "";
  state.treeNodeEditId = String(id || "");
  state.treeNodeEditName = currentName || "";
  state.treeNodeEditPageId = String(pageId || "");
  state.treeNodeEditVirtual = Boolean(isVirtual);
  setText("tree-node-modal-title", `编辑${nodeLabel}`);
  if (type === "component" && isVirtual) {
    setText("tree-node-modal-summary", "将为当前页面创建组件，并同步更新右侧列表中的组件字段。");
  } else {
    setText("tree-node-modal-summary", `更新${nodeLabel}名称后会立即同步到当前项目。`);
  }
  setText("tree-node-modal-label", `${nodeLabel}名称`);
  $("tree-node-name-input").value = currentName || "";
  openModal("tree-node-modal");
  requestAnimationFrame(() => {
    $("tree-node-name-input")?.focus();
    $("tree-node-name-input")?.select();
  });
}

function closeTreeNodeModal() {
  closeModal("tree-node-modal");
  setText("tree-node-modal-summary", "");
  $("tree-node-name-input").value = "";
  state.treeNodeEditType = "";
  state.treeNodeEditId = "";
  state.treeNodeEditName = "";
  state.treeNodeEditPageId = "";
  state.treeNodeEditVirtual = false;
}

function addElementLocator() {
  const locatorType = $("locator-form-type")?.value?.trim() || "css";
  const locatorValue = $("locator-form-value")?.value?.trim() || "";
  const locatorExpression = buildElementLocatorExpression(locatorType, locatorValue);
  const isPrimary = Boolean($("locator-form-primary")?.checked);
  if (!locatorValue) {
    throw new Error("请输入 Locator 值");
  }
  if (isPrimary) {
    document.querySelectorAll('[data-field="locatorPrimary"]').forEach((input) => {
      input.checked = false;
    });
  }
  appendElementLocatorRow({
    locatorType,
    locatorValue,
    locatorExpression,
    isPrimary,
    source: "manual",
    status: "active",
    score: 80,
    confidence: 80
  });
  closeLocatorFormModal();
  refreshTableCellTitles($("element-detail-body"));
  showNotice("操作成功", "Locator 已添加至当前列表，保存元素后生效。");
}

async function saveElement(options = {}) {
  const locatorRows = readElementLocatorRows()
    .filter((row) => row.locatorType && row.locatorValue);
  if (!locatorRows.length) {
    throw new Error("请至少维护一个 Locator");
  }
  if (!locatorRows.some((row) => row.isPrimary)) {
    locatorRows[0].isPrimary = true;
  }
  const body = {
    pageId: $("edit-element-page")?.value ? Number($("edit-element-page").value) : null,
    componentId: $("edit-element-component")?.value ? Number($("edit-element-component").value) : null,
    elementName: $("edit-element-name").value.trim(),
    validStatus: Number($("edit-element-valid-status")?.value || 0) === 1 ? 1 : 0,
    elementType: $("edit-element-type")?.value || null,
    defaultAction: $("edit-element-action")?.value || null,
    sourceUrl: $("edit-element-source-url")?.value?.trim() || null,
    locators: locatorRows
  };
  if (!body.elementName) {
    throw new Error("请输入元素名称");
  }
  if (state.currentElementId) {
    await api(`/api/elements/${state.currentElementId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  await loadElements();
  await showElementDetail(state.currentElementId);
  if (options.notice !== false) {
    showNotice(options.noticeTitle || "操作成功", options.noticeMessage || "元素信息已保存。");
  }
    return;
  }
  const created = await api("/api/elements", {
    method: "POST",
    body: JSON.stringify({
      projectId: Number(state.selectedProjectId),
      ...body
    })
  });
  await loadElements();
  await showElementDetail(Number(created.id));
  if (options.notice !== false) {
    showNotice(options.noticeTitle || "操作成功", options.noticeMessage || "元素信息已创建。");
  }
}

async function saveElementLocatorRow(rowElement) {
  if (!(rowElement instanceof HTMLElement)) {
    throw new Error("未找到 Locator 行");
  }
  const locatorType = rowElement.querySelector('[data-field="locatorType"]')?.value?.trim() || "";
  const locatorValue = rowElement.querySelector('[data-field="locatorValue"]')?.value?.trim() || "";
  if (!locatorType || !locatorValue) {
    throw new Error("请先填写完整的 Locator 类型和 Locator 值");
  }
  await saveElement({
    noticeTitle: "操作成功",
    noticeMessage: "Locator 已保存。"
  });
}

async function renameTreeNode(type, id, nextName, options = {}) {
  const trimmedName = String(nextName || "").trim();
  if (!trimmedName) {
    throw new Error("请输入名称");
  }
  if (!type || !id) {
    throw new Error("未找到要编辑的节点");
  }
  if (type === "page") {
    await api(`/api/pages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ pageName: trimmedName })
    });
  } else if (type === "component") {
    if (options.isVirtual || id === "unassigned") {
      await api("/api/components/materialize-group", {
        method: "POST",
        body: JSON.stringify({
          projectId: Number(state.selectedProjectId),
          pageId:
            options.pageId && String(options.pageId) !== "-1" && String(options.pageId) !== "undefined"
              ? Number(options.pageId)
              : undefined,
          componentName: trimmedName
        })
      });
    } else {
      await api(`/api/components/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ componentName: trimmedName })
      });
    }
  } else if (type === "element") {
    await api(`/api/elements/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ elementName: trimmedName })
    });
  }
  await loadElements();
  if (state.currentElementId && type === "element" && Number(state.currentElementId) === Number(id)) {
    await showElementDetail(Number(id));
  }
  renderShell();
}

async function saveTreeNodeName() {
  const nextName = $("tree-node-name-input").value.trim();
  if (!nextName) {
    throw new Error("请输入名称");
  }
  if (nextName === state.treeNodeEditName) {
    closeTreeNodeModal();
    return;
  }
  const type = state.treeNodeEditType;
  const id = state.treeNodeEditId;
  const pageId = state.treeNodeEditPageId;
  const isVirtual = state.treeNodeEditVirtual;
  closeTreeNodeModal();
  await renameTreeNode(type, id, nextName, { pageId, isVirtual });
}

async function deleteTreeNode(type, id, currentName = "") {
  if (!type || !id) {
    throw new Error("未找到要删除的节点");
  }
  const confirmed = await confirmAction({
    title: "删除元素层级",
    message: `确认删除 ${currentName || "当前节点"}？如果已被用例引用，系统会阻止删除。`,
    confirmText: "删除"
  });
  if (!confirmed) {
    return;
  }
  if (type === "page") {
    await api(`/api/pages/${id}`, { method: "DELETE" });
  } else if (type === "component") {
    await api(`/api/components/${id}`, { method: "DELETE" });
  } else if (type === "element") {
    await api(`/api/elements/${id}`, { method: "DELETE" });
  }
  if (state.selectedElementPageId === String(id) && type === "page") {
    state.selectedElementPageId = "all";
    localStorage.setItem("tp_element_page_id", "all");
  }
  await loadElements();
  renderShell();
}

async function disableElement(elementId) {
  const confirmed = await confirmAction({
    title: "删除元素",
    message: "确认删除该元素？如果已被用例引用，系统会阻止删除。",
    confirmText: "删除"
  });
  if (!confirmed) return;
  await api(`/api/elements/${elementId}`, { method: "DELETE" });
  closeElementDetail();
  await loadElements();
  showNotice("操作成功", "元素信息已删除。");
}

async function runCase(caseId) {
  const data = await api("/api/execution-jobs", {
    method: "POST",
    body: JSON.stringify({
      projectId: Number(state.selectedProjectId),
      environmentId: state.selectedEnvironmentId || state.environments[0]?.id || 1,
      browser: "chrome",
      caseIds: [Number(caseId)],
      config: {
        headless: true,
        retries: 0,
        screenshot: true,
        video: true,
        trace: false
      }
    })
  });
  await loadProjectData();
  showNotice("操作成功", `执行任务已创建，任务编号：${data.jobNo}`);
}

function caseGroupOptions(selected) {
  return `<option value="">未分组</option>${state.caseGroups
    .map(
      (group) =>
        `<option value="${group.id}" ${Number(group.id) === Number(selected) ? "selected" : ""}>${escapeHtml(group.groupName)}</option>`
    )
    .join("")}`;
}

function caseStepActionOptions(selected) {
  return ["goto", "click", "fill", "press", "select", "assert"]
    .map((action) => `<option value="${action}" ${action === selected ? "selected" : ""}>${action}</option>`)
    .join("");
}

function caseStepElementOptions(selected) {
  return `<option value="">未绑定元素</option>${state.elements
    .map(
      (element) =>
        `<option value="${element.id}" ${Number(element.id) === Number(selected) ? "selected" : ""}>${escapeHtml(
          element.elementName
        )}</option>`
    )
    .join("")}`;
}

function selectedElementName(elementId, candidates = []) {
  const element = [...(state.elementPickerElements || []), ...(candidates || []), ...state.elements].find(
    (item) => Number(item.id) === Number(elementId)
  );
  return element ? element.elementName : "未绑定元素";
}

function pickerElementSource() {
  return state.elementPickerElements.length ? state.elementPickerElements : state.elements;
}

function elementPickerPageOptions() {
  const pageMap = new Map();
  pickerElementSource().forEach((element) => {
    pageMap.set(String(element.pageId || ""), element.pageName || "未分组页面");
  });
  return `<option value="">全部页面</option>${Array.from(pageMap.entries())
    .map(
      ([pageId, pageName]) =>
        `<option value="${escapeHtml(pageId)}" ${String(state.elementPickerPageId || "") === String(pageId) ? "selected" : ""}>${escapeHtml(pageName)}</option>`
    )
    .join("")}`;
}

function elementPickerComponentOptions() {
  const componentMap = new Map();
  pickerElementSource()
    .filter((element) => !state.elementPickerPageId || String(element.pageId || "") === String(state.elementPickerPageId))
    .forEach((element) => {
      componentMap.set(String(element.componentId || ""), element.componentName || "未分组组件");
    });
  return `<option value="">全部组件</option>${Array.from(componentMap.entries())
    .map(
      ([componentId, componentName]) =>
        `<option value="${escapeHtml(componentId)}" ${String(state.elementPickerComponentId || "") === String(componentId) ? "selected" : ""}>${escapeHtml(componentName)}</option>`
    )
    .join("")}`;
}

function filteredPickerElements() {
  const keyword = String(state.elementPickerKeyword || "").trim().toLowerCase();
  return pickerElementSource().filter((element) => {
    if (state.elementPickerPageId && String(element.pageId || "") !== String(state.elementPickerPageId)) return false;
    if (state.elementPickerComponentId && String(element.componentId || "") !== String(state.elementPickerComponentId)) {
      return false;
    }
    if (!keyword) return true;
    return [
      element.elementName,
      element.pageName,
      element.componentName,
      element.elementType,
      element.primaryLocatorType,
      element.primaryLocatorValue
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });
}

function renderElementPickerModal() {
  $("element-picker-body").innerHTML = `
    <div class="toolbar compact-toolbar">
      <label>页面<select id="element-picker-page">${elementPickerPageOptions()}</select></label>
      <label>组件<select id="element-picker-component">${elementPickerComponentOptions()}</select></label>
      <label>关键字<input id="element-picker-keyword" value="${escapeHtml(state.elementPickerKeyword || "")}" placeholder="元素 / 页面 / 组件 / Locator" /></label>
      <button class="secondary small" data-action="reset-element-picker">重置</button>
    </div>
    <div class="table-wrap">
      <table class="data-table element-picker-table">
        <thead><tr><th>元素名称</th><th>页面</th><th>组件</th><th>类型</th><th>主定位</th><th>操作</th></tr></thead>
        <tbody>${
          filteredPickerElements()
            .map(
              (element) => `<tr>
                <td><strong>${escapeHtml(element.elementName)}</strong></td>
                <td>${escapeHtml(element.pageName || "未分组页面")}</td>
                <td>${escapeHtml(element.componentName || "未分组组件")}</td>
                <td>${escapeHtml(element.elementType || "-")}</td>
                <td class="cell-url">${escapeHtml(element.primaryLocatorType || "-")} · ${escapeHtml(element.primaryLocatorValue || "-")}</td>
                <td><button class="small" data-action="select-step-element" data-element-id="${element.id}">选择</button></td>
              </tr>`
            )
            .join("") || `<tr><td colspan="6">暂无匹配元素。</td></tr>`
        }</tbody>
      </table>
    </div>`;
  refreshTableCellTitles($("element-picker-body"));
}

async function openElementPickerModal(stepId) {
  state.elementPickerStepId = Number(stepId);
  state.elementPickerKeyword = "";
  state.elementPickerPageId = "";
  state.elementPickerComponentId = "";
  state.elementPickerElements = await api(`/api/elements?projectId=${state.selectedProjectId}`);
  renderElementPickerModal();
  $("element-picker-modal")?.classList.remove("hidden");
}

function closeElementPickerModal() {
  closeModal("element-picker-modal");
  state.elementPickerStepId = 0;
  state.elementPickerElements = [];
}

function applyStepElement(elementId) {
  const stepId = Number(state.elementPickerStepId);
  const row = document.querySelector(`tr[data-step-id="${stepId}"]`);
  const element = pickerElementSource().find((item) => Number(item.id) === Number(elementId));
  if (!(row instanceof HTMLElement) || !element) return;
  const input = row.querySelector('[data-field="elementId"]');
  const label = row.querySelector('[data-field="elementName"]');
  if (input instanceof HTMLInputElement) {
    input.value = String(element.id);
  }
  if (label instanceof HTMLElement) {
    label.textContent = element.elementName;
    label.setAttribute("title", `${element.pageName || "未分组页面"} / ${element.componentName || "未分组组件"} / ${element.elementName}`);
  }
  closeElementPickerModal();
}

function normalizeCaseDetail(detail) {
  const visibleSteps = (detail.steps || []).map((step) => ({
    ...step,
    stepDsl:
      step.stepDsl && typeof step.stepDsl === "object" && !Array.isArray(step.stepDsl)
        ? step.stepDsl
        : {},
    locatorSnapshot: Array.isArray(step.locatorSnapshot) ? step.locatorSnapshot : []
  }));
  return {
    ...detail,
    steps: visibleSteps,
    visibleStepCount: Number(detail.visibleStepCount ?? detail.stepTotalCount ?? visibleSteps.length ?? 0),
    stepTotalCount: Number(detail.stepTotalCount ?? visibleSteps.length ?? 0)
  };
}

function caseStepValue(step) {
  const params = step.stepDsl?.params && typeof step.stepDsl.params === "object" ? step.stepDsl.params : {};
  return (
    params.url ??
    params.value ??
    params.text ??
    params.key ??
    step.stepDsl?.value ??
    step.stepDsl?.text ??
    ""
  );
}

async function showCaseDetail(caseId) {
  const detail = normalizeCaseDetail(await api(`/api/test-cases/${caseId}`));
  openModal("case-detail-modal");
  state.currentCaseId = Number(detail.id || caseId);
  state.currentCaseElements = Array.isArray(detail.usedElements) ? detail.usedElements : [];
  setText("case-detail-title", `用例信息：${detail.caseName}`);
  setText("case-detail-summary", `${detail.caseCode || "-"} · ${detail.groupName || "未分组"} · ${detail.visibleStepCount} 步`);
  renderCaseDetail(detail);
}

function showNewCaseForm() {
  state.currentCaseId = 0;
  state.currentCaseElements = [];
  openModal("case-detail-modal");
  setText("case-detail-title", "新建用例");
  setText("case-detail-summary", "先保存基础信息，再继续新增和编辑步骤。");
  renderCaseDetail(
    normalizeCaseDetail({
    id: 0,
    caseName: "",
    caseCode: "",
    caseDesc: "",
    priority: "medium",
    caseGroupId: "",
    steps: [],
    variables: [],
    usedElements: [],
    recentExecutions: [],
    reports: []
    })
  );
}

function renderCaseDetail(detail) {
  const caseElements = Array.isArray(detail.usedElements) ? detail.usedElements : state.currentCaseElements || [];
  const stepRows = (detail.steps || [])
    .map(
      (step) => `<tr data-step-id="${step.id}">
        <td><input data-field="stepOrder" type="number" min="1" value="${step.stepOrder}" /></td>
        <td><input data-field="stepName" value="${escapeHtml(step.stepName || "")}" placeholder="步骤名称" /></td>
        <td><select data-field="action">${caseStepActionOptions(step.action)}</select></td>
        <td>
          <input data-field="elementId" type="hidden" value="${step.elementId || ""}" />
          <input data-field="stepDslRaw" type="hidden" value="${escapeHtml(JSON.stringify(step.stepDsl || {}))}" />
          <div class="step-element-picker">
            <span data-field="elementName" title="${escapeHtml(selectedElementName(step.elementId, caseElements))}">${escapeHtml(selectedElementName(step.elementId, caseElements))}</span>
            <button class="small secondary" data-action="open-step-element-picker" data-step-id="${step.id}">选择元素</button>
          </div>
        </td>
        <td><input data-field="stepValue" value="${escapeHtml(caseStepValue(step))}" placeholder="参数 / 输入值" /></td>
        <td>
          <div class="table-actions">
            <button class="small secondary" data-action="save-case-step" data-step-id="${step.id}">保存</button>
            <button class="small danger" data-action="delete-case-step" data-step-id="${step.id}">删除</button>
          </div>
        </td>
      </tr>`
    )
    .join("");
  const elementRows = (detail.usedElements || [])
    .map(
      (element) => `<tr>
        <td>${escapeHtml(element.elementName)}</td>
        <td>${escapeHtml(element.pageName || "未分组页面")}</td>
        <td>${escapeHtml(element.componentName || "未分组组件")}</td>
        <td>${escapeHtml(element.elementType || "-")}</td>
      </tr>`
    )
    .join("");
  const executionRows = (detail.recentExecutions || [])
    .map(
      (execution) => `<tr>
        <td>${escapeHtml(execution.jobNo)}</td>
        <td>${escapeHtml(execution.browser || "-")}</td>
        <td>${badge(execution.status)}</td>
        <td>${fmt(execution.finishedAt || execution.startedAt)}</td>
        <td>${escapeHtml(execution.errorMessage || "-")}</td>
      </tr>`
    )
    .join("");
  const reportRows = (detail.reports || [])
    .map(
      (report) => `<tr>
        <td>${escapeHtml(report.jobNo)}</td>
        <td>${badge(report.status)}</td>
        <td>${fmt(report.finishedAt)}</td>
        <td>${
          Number(report.artifactId || 0)
            ? `<button type="button" class="artifact-link" data-action="artifact-access" data-artifact-id="${Number(report.artifactId || 0)}" data-mode="download" data-file-name="${escapeHtml(report.traceFileName || "")}">${escapeHtml(report.traceFileName || "下载文件")}</button>`
            : escapeHtml(report.traceFileName || "-")
        }</td>
      </tr>`
    )
    .join("");
  $("case-detail-body").innerHTML = `
    <div class="detail-grid">
      <section>
        <h3>基础信息</h3>
        <div class="project-form">
          <label>用例名称<input id="edit-case-name" value="${escapeHtml(detail.caseName || "")}" /></label>
          <label>用例编码<input id="edit-case-code" value="${escapeHtml(detail.caseCode || "")}" /></label>
          <label>所属模块<select id="edit-case-group">${caseGroupOptions(detail.caseGroupId)}</select></label>
          <label>优先级
            <select id="edit-case-priority">
              <option value="high" ${detail.priority === "high" ? "selected" : ""}>高</option>
              <option value="medium" ${detail.priority === "medium" ? "selected" : ""}>中</option>
              <option value="low" ${detail.priority === "low" ? "selected" : ""}>低</option>
            </select>
          </label>
          <label>描述<textarea id="edit-case-desc">${escapeHtml(detail.caseDesc || "")}</textarea></label>
          <div class="actions">
            <button data-action="save-case">${detail.id ? "保存" : "创建"}</button>
            ${detail.id ? `<button class="secondary" data-action="copy-case" data-case-id="${detail.id}">复制用例</button>
            <button class="danger" data-action="delete-case" data-case-id="${detail.id}">删除用例</button>` : ""}
          </div>
        </div>
      </section>
      <section>
        <h3>变量引用</h3>
        <div class="empty-state">暂未检测到变量引用。</div>
      </section>
    </div>
    <div class="section-inline">
      <h3>步骤列表</h3>
      <button class="small" data-action="add-case-step" ${detail.id ? "" : "disabled"}>新增步骤</button>
    </div>
    ${detail.id ? "" : `<div class="empty-state">保存用例后才可以新增和编辑步骤。</div>`}
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>顺序</th><th>步骤名称</th><th>动作</th><th>元素</th><th>参数</th><th>操作</th></tr></thead>
      <tbody>${stepRows || `<tr><td colspan="6">暂无步骤。</td></tr>`}</tbody>
    </table></div>
    <h3>使用元素</h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>元素名称</th><th>页面</th><th>组件</th><th>类型</th></tr></thead>
      <tbody>${elementRows || `<tr><td colspan="4">暂无使用元素。</td></tr>`}</tbody>
    </table></div>
    <h3>最近执行记录</h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>任务编号</th><th>浏览器</th><th>状态</th><th>时间</th><th>失败原因</th></tr></thead>
      <tbody>${executionRows || `<tr><td colspan="5">暂无执行记录。</td></tr>`}</tbody>
    </table></div>
    <h3>关联报告</h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>任务编号</th><th>状态</th><th>完成时间</th><th>产物</th></tr></thead>
      <tbody>${reportRows || `<tr><td colspan="4">暂无关联报告。</td></tr>`}</tbody>
    </table></div>`;
}

function closeCaseDetail() {
  closeModal("case-detail-modal");
  $("case-detail-body").innerHTML = "";
  setText("case-detail-summary", "");
  state.currentCaseId = 0;
  state.currentCaseElements = [];
}

async function saveCase() {
  if (state.caseSaving) return;
  const caseGroupValue = $("edit-case-group").value;
  const body = {
    projectId: Number(state.selectedProjectId),
    caseName: $("edit-case-name").value.trim(),
    caseCode: $("edit-case-code").value.trim() || undefined,
    caseGroupId: caseGroupValue ? Number(caseGroupValue) : null,
    priority: $("edit-case-priority").value,
    caseDesc: $("edit-case-desc").value.trim()
  };
  if (!body.caseName) {
    showNotice("请填写用例名称");
    return;
  }
  state.caseSaving = true;
  const saveButton = document.querySelector('[data-action="save-case"]');
  if (saveButton instanceof HTMLButtonElement) {
    saveButton.disabled = true;
  }
  try {
    if (state.currentCaseId) {
      const caseId = Number(state.currentCaseId);
      await api(`/api/test-cases/${caseId}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      await loadCases();
      await showCaseDetail(caseId);
      showNotice("操作成功", "用例基本信息已保存。");
    } else {
      const existingCase = body.caseCode
        ? state.cases.find((item) => String(item.caseCode || "") === String(body.caseCode))
        : null;
      if (existingCase) {
        state.currentCaseId = Number(existingCase.id);
        await api(`/api/test-cases/${existingCase.id}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        });
        await loadCases();
        await showCaseDetail(existingCase.id);
        showNotice("操作成功", "用例基本信息已保存。");
        return;
      }
      const data = await api("/api/test-cases", {
        method: "POST",
        body: JSON.stringify(body)
      });
      const caseId = Number(data.caseId);
      state.currentCaseId = caseId;
      await loadCases();
      await showCaseDetail(caseId);
      showNotice("操作成功", "用例已创建。");
    }
  } finally {
    state.caseSaving = false;
    if (saveButton instanceof HTMLButtonElement) {
      saveButton.disabled = false;
    }
  }
}

async function copyCase(caseId) {
  const data = await api(`/api/test-cases/${caseId}/copy`, { method: "POST" });
  await loadCases();
  await showCaseDetail(data.caseId);
}

async function addCaseStep() {
  const caseId = Number(state.currentCaseId);
  if (!caseId) {
    showNotice("请先保存用例基础信息。");
    return;
  }
  const detail = await api(`/api/test-cases/${caseId}`);
  const nextOrder = Number(detail.stepTotalCount || (detail.steps || []).length || 0) + 1;
  await api(`/api/test-cases/${caseId}/steps`, {
    method: "POST",
    body: JSON.stringify({
      stepOrder: nextOrder,
      stepName: `步骤 ${nextOrder}`,
      action: "click",
      elementId: state.elements[0]?.id || null,
      stepDsl: { action: "click", params: {} }
    })
  });
  await showCaseDetail(caseId);
  showNotice("操作成功", "操作步骤已新增。");
}

function readCaseStepPayload(stepId) {
  const row = document.querySelector(`tr[data-step-id="${stepId}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error("未找到步骤编辑行");
  }
  const rawStepDsl = parseJsonMaybe(row.querySelector('[data-field="stepDslRaw"]')?.value || "", {});
  const existingStepDsl =
    rawStepDsl && typeof rawStepDsl === "object" && !Array.isArray(rawStepDsl)
      ? { ...rawStepDsl }
      : {};
  const existingParams =
    existingStepDsl.params && typeof existingStepDsl.params === "object" && !Array.isArray(existingStepDsl.params)
      ? { ...existingStepDsl.params }
      : {};
  delete existingStepDsl.value;
  delete existingStepDsl.text;
  delete existingParams.url;
  delete existingParams.value;
  delete existingParams.text;
  delete existingParams.key;
  const elementIdValue = row.querySelector('[data-field="elementId"]')?.value || "";
  const stepValue = row.querySelector('[data-field="stepValue"]')?.value?.trim() || "";
  const action = row.querySelector('[data-field="action"]')?.value || "click";
  const params = existingParams;
  if (stepValue) {
    if (action === "goto") {
      params.url = stepValue;
    } else if (action === "press") {
      params.key = stepValue;
    } else if (action === "assert") {
      params.text = stepValue;
    } else {
      params.value = stepValue;
    }
  }
  return {
    stepOrder: Number(row.querySelector('[data-field="stepOrder"]')?.value || 1),
    stepName: row.querySelector('[data-field="stepName"]')?.value?.trim() || `步骤 ${stepId}`,
    action,
    elementId: elementIdValue ? Number(elementIdValue) : null,
    stepDsl: {
      ...existingStepDsl,
      action,
      params
    }
  };
}

async function saveCaseStep(stepId) {
  const caseId = Number(state.currentCaseId);
  if (!caseId) return;
  await api(`/api/test-cases/${caseId}/steps/${stepId}`, {
    method: "PATCH",
    body: JSON.stringify(readCaseStepPayload(stepId))
  });
  await showCaseDetail(caseId);
  showNotice("操作成功", "操作步骤已保存。");
}

async function deleteCaseStep(stepId) {
  const caseId = Number(state.currentCaseId);
  if (!caseId) return;
  const confirmed = await confirmAction({
    title: "删除用例步骤",
    message: "确认删除该步骤？",
    confirmText: "删除"
  });
  if (!confirmed) return;
  await api(`/api/test-cases/${caseId}/steps/${stepId}`, {
    method: "DELETE"
  });
  await showCaseDetail(caseId);
  showNotice("操作成功", "操作步骤已删除。");
}

async function deleteCase(caseId) {
  const confirmed = await confirmAction({
    title: "删除用例",
    message: "确认删除该用例？",
    confirmText: "删除"
  });
  if (!confirmed) return;
  await api(`/api/test-cases/${caseId}`, {
    method: "DELETE"
  });
  closeCaseDetail();
  await loadCases();
  showNotice("操作成功", "用例已删除。");
}

async function createExecutionJobFromForm() {
  const settings = currentProjectSettings().execution;
  const caseIds = state.selectedExecutionCaseIds
    .map((caseId) => Number(caseId))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (!caseIds.length) {
    showNotice("请选择至少一个用例。");
    return;
  }
  const environmentId = Number($("execution-environment-select").value || state.selectedEnvironmentId || 0);
  const data = await api("/api/execution-jobs", {
    method: "POST",
    body: JSON.stringify({
      projectId: Number(state.selectedProjectId),
      environmentId: environmentId || undefined,
      browser: $("execution-browser-select").value,
      caseIds,
      config: {
        headless: $("execution-headless").checked,
        retries: Number($("execution-retries").value || 0),
        timeoutMs: Number(settings.defaultTimeoutMs || 30000),
        screenshot: $("execution-screenshot").checked,
        video: $("execution-video").checked,
        trace: false
      }
    })
  });
  await loadProjectData();
  closeModal("execution-create-modal");
  await showJob(data.jobNo, { modal: true });
}

async function rerunJob(jobNo, failedOnly = false) {
  const data = await api(`/api/execution-jobs/${encodeURIComponent(jobNo)}/rerun`, {
    method: "POST",
    body: JSON.stringify({ failedOnly })
  });
  await loadProjectData();
  await showJob(data.jobNo);
}

async function downloadReport(jobNo) {
  const job = await api(`/api/execution-jobs/${encodeURIComponent(jobNo)}`);
  const blob = new Blob([JSON.stringify(job, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${jobNo}.report.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function showJob(jobNo, options = {}) {
  const job = await api(`/api/execution-jobs/${encodeURIComponent(jobNo)}`);
  const html = renderJobDetail(job);
  const useModal = options.modal !== false;
  if (useModal) {
    openModal("job-detail-modal");
  setText("job-detail-title", `执行任务信息：${job.jobNo}`);
    setText("job-detail-summary", `${job.environmentName || "-"} · ${job.browser || "-"} · ${calcPassRate(job)}% 通过率`);
    $("job-detail-body").innerHTML = html;
    refreshTableCellTitles($("job-detail-body"));
    return;
  }
}

function renderJobDetail(job) {
  const caseRows = (job.caseResults || [])
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.caseName || "-")}</td>
        <td>${badge(item.status)}</td>
        <td>${fmtDuration(item.durationMs)}</td>
        <td>${fmt(item.startedAt)}</td>
        <td>${fmt(item.finishedAt)}</td>
        <td>${escapeHtml(item.errorMessage || "-")}</td>
      </tr>`
    )
    .join("");
  const renderArtifactPreview = (artifact) => {
    const artifactId = Number(artifact.artifactId || 0);
    if (!artifactId) return "-";
    const mode = artifact.viewMode === "inline" ? "inline" : "download";
    const label =
      artifact.artifactType === "screenshot"
        ? "查看截图"
        : artifact.artifactType === "video"
          ? "查看视频"
          : "下载/查看";
    return `<button type="button" class="artifact-link" data-action="artifact-access" data-artifact-id="${artifactId}" data-mode="${escapeHtml(mode)}" data-file-name="${escapeHtml(artifact.fileName || "")}">${label}</button>`;
  };
  const artifactHtml = job.artifacts?.length
    ? `<h3>产物</h3><div class="table-wrap"><table class="data-table artifact-table">
        <thead><tr><th>类型</th><th>文件名</th><th>查看</th><th>大小</th><th>创建时间</th></tr></thead>
        <tbody>${job.artifacts
          .map(
            (artifact) => `<tr>
              <td>${escapeHtml(artifact.artifactType)}</td>
              <td>${escapeHtml(artifact.fileName || "-")}</td>
              <td>${renderArtifactPreview(artifact)}</td>
              <td>${artifact.fileSize || "-"}</td>
              <td>${fmt(artifact.createdAt)}</td>
            </tr>`
          )
          .join("")}</tbody></table></div>`
    : "";
  return `<h3>${escapeHtml(job.jobNo)}</h3>
    <div class="detail-grid">
      <section>
        <h3>执行概况</h3>
        <div class="settings-list">
          <div class="settings-row"><span>状态</span><strong>${badge(job.status)}</strong></div>
          <div class="settings-row"><span>执行环境</span><strong>${escapeHtml(job.environmentName || "-")}</strong></div>
          <div class="settings-row"><span>浏览器</span><strong>${escapeHtml(job.browser || "-")}</strong></div>
          <div class="settings-row"><span>用例结果</span><strong>${Number(job.passedCases || 0)} 通过 / ${Number(job.failedCases || 0)} 失败 / ${Number(job.totalCases || 0)} 总数</strong></div>
          <div class="settings-row"><span>通过率</span><strong>${calcPassRate(job)}%</strong></div>
        </div>
      </section>
      <section>
        <h3>时间与错误</h3>
        <div class="settings-list">
          <div class="settings-row"><span>执行人</span><strong>${escapeHtml(job.createdByName || "-")}</strong></div>
          <div class="settings-row"><span>开始时间</span><strong>${fmt(job.startedAt || job.queuedAt)}</strong></div>
          <div class="settings-row"><span>结束时间</span><strong>${fmt(job.finishedAt)}</strong></div>
          <div class="settings-row"><span>耗时</span><strong>${fmtDuration(job.durationMs)}</strong></div>
          <div class="settings-row"><span>失败原因</span><strong>${escapeHtml(job.errorMessage || "-")}</strong></div>
        </div>
      </section>
    </div>
    <h3>用例结果</h3>
    <div class="table-wrap"><table class="data-table case-result-table">
      <thead><tr><th>用例名称</th><th>状态</th><th>耗时</th><th>开始时间</th><th>结束时间</th><th>失败原因</th></tr></thead>
      <tbody>${caseRows || `<tr><td colspan="6">暂无用例结果。</td></tr>`}</tbody>
    </table></div>
    <h3>步骤结果</h3>
    ${renderStepTable(job.stepResults || [])}
    ${artifactHtml}`;
}

function renderResolvedLocator(step) {
  const locator = step.resolvedLocator;
  if (!locator || !locator.locatorType || !locator.locatorValue) {
    return "-";
  }
  const resolutionText =
    locator.source === "ai_candidate"
      ? "AI 自愈命中"
      : locator.resolution === "fallback"
        ? "候选命中"
        : "主定位命中";
  const text = `${locator.locatorType} · ${locator.locatorValue}`;
  return `<span title="${escapeHtml(
    `${resolutionText} (${locator.candidateIndex || 1}/${locator.candidateTotal || 1}) | ${text}`
  )}">${escapeHtml(text)}</span>`;
}

function shortLocatorValue(value, maxLength = 80) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function locatorFailureLabel(message) {
  const text = String(message || "");
  if (/strict mode violation/i.test(text)) return "匹配到多个元素";
  if (/not visible|element is not visible/i.test(text)) return "元素不可见";
  if (/Timeout \d+ms exceeded|timeout/i.test(text)) return "等待超时";
  if (/not enabled|element is disabled/i.test(text)) return "元素不可用";
  if (/detached|not attached/i.test(text)) return "元素已脱离页面";
  return "定位失败";
}

function summarizeLocatorAttempts(attempts) {
  if (!Array.isArray(attempts) || !attempts.length) {
    return "";
  }
  const failedAttempts = attempts.filter((attempt) => !attempt.success);
  const passedAttempt = attempts.find((attempt) => attempt.success);
  if (passedAttempt) {
    return `Locator 命中：${passedAttempt.locatorType}=${shortLocatorValue(passedAttempt.locatorValue, 60)}（第 ${passedAttempt.candidateIndex || 1}/${passedAttempt.candidateTotal || attempts.length} 个候选）`;
  }
  const reasonCounts = failedAttempts.reduce((acc, attempt) => {
    const label = locatorFailureLabel(attempt.errorMessage);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const reasonText = Object.entries(reasonCounts)
    .map(([label, count]) => `${label} ${count} 次`)
    .join("，");
  const candidateText = failedAttempts
    .slice(0, 3)
    .map((attempt) => `${attempt.locatorType}=${shortLocatorValue(attempt.locatorValue, 50)}`)
    .join("；");
  return `Locator 候选全部失败：共 ${attempts.length} 次，${reasonText || "定位失败"}。候选：${candidateText}${failedAttempts.length > 3 ? "..." : ""}`;
}

function isLocatorFallbackErrorMessage(message) {
  return /All Locator candidates failed/i.test(String(message || ""));
}

function formatStepParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return "-";
  }
  const visibleParams = Object.entries(params).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === "") return acc;
    acc[key] = value;
    return acc;
  }, {});
  if (!Object.keys(visibleParams).length) {
    return "-";
  }
  return shortLocatorValue(JSON.stringify(visibleParams), 120);
}

function renderStepInfo(step) {
  const parts = [];
  const locatorSummary = summarizeLocatorAttempts(step.locatorAttempts);
  if (locatorSummary) {
    parts.push(locatorSummary);
  }
  if (step.errorMessage && !isLocatorFallbackErrorMessage(step.errorMessage)) {
    parts.push(shortLocatorValue(step.errorMessage, 180));
  }
  if (step.aiHeal) {
    if (step.aiHeal.used) {
      parts.push(`AI ${statusLabel(step.aiHeal.status)}：${step.aiHeal.reason || "-"}，置信度 ${step.aiHeal.confidence || 0}`);
    } else if (step.aiHeal.status === "skipped") {
      parts.push(`AI 未触发：${step.aiHeal.reason || "-"}`);
    }
  }
  if (step.aiCaptcha?.used) {
    const attemptCount = Array.isArray(step.aiCaptcha.attempts) ? step.aiCaptcha.attempts.length : 1;
    parts.push(`验证码识别：${step.aiCaptcha.text || "-"}，置信度 ${step.aiCaptcha.confidence || 0}，尝试 ${attemptCount} 次`);
  }
  return parts.join("；") || "-";
}

function renderStepTable(steps) {
  return `<div class="table-wrap"><table class="data-table step-result-table">
    <thead><tr><th>#</th><th>步骤名称</th><th>动作</th><th>元素</th><th>参数</th><th>状态</th><th>耗时</th><th>实际命中 Locator</th><th>信息</th></tr></thead>
    <tbody>
      ${steps.length
        ? steps
            .map(
              (step) =>
                `<tr>
                  <td>${step.stepOrder}</td>
                  <td>${escapeHtml(step.stepName || "-")}</td>
                  <td>${escapeHtml(step.action)}</td>
                  <td>${escapeHtml(step.elementName || "-")}</td>
                  <td class="cell-url">${escapeHtml(formatStepParams(step.params))}</td>
                  <td>${badge(step.status)}</td>
                  <td>${fmtDuration(step.durationMs)}</td>
                  <td class="cell-url">${renderResolvedLocator(step)}</td>
                  <td>${escapeHtml(renderStepInfo(step))}</td>
                </tr>`
            )
            .join("")
        : `<tr><td colspan="9">暂无步骤结果。</td></tr>`}
    </tbody>
  </table></div>`;
}

function closeJobDetail() {
  closeModal("job-detail-modal");
  $("job-detail-body").innerHTML = "";
  setText("job-detail-summary", "");
}

function readStrategySettingsForm() {
  return {
    execution: {
      defaultBrowser: $("strategy-default-browser")?.value || "chrome",
      defaultHeadless: Boolean($("strategy-default-headless")?.checked),
      defaultRetries: Number($("strategy-default-retries")?.value || 0),
      defaultTimeoutMs: Number($("strategy-default-timeout-ms")?.value || 30000),
      defaultScreenshot: true,
      defaultVideo: true,
      defaultTrace: false,
      reportRetentionDays: Number($("strategy-report-retention-days")?.value || 30),
      logRetentionDays: Number($("strategy-log-retention-days")?.value || 7)
    }
  };
}

function readAgentSettingsForm() {
  return {
    agent: {
      baseUrl: $("agent-settings-base-url")?.value?.trim() || "",
      healthPath: $("agent-settings-health-path")?.value?.trim() || "/health",
      checkBeforeRecording: Boolean($("agent-settings-check-before-recording")?.checked),
      autoCheckOnLoad: Boolean($("agent-settings-auto-check-on-load")?.checked)
    }
  };
}

async function saveStrategySettings() {
  state.projectSettings = normalizeProjectSettings(
    await api(`/api/projects/${state.selectedProjectId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(readStrategySettingsForm())
    })
  );
  syncProjectSettingsToInputs();
  showNotice("操作成功", "执行策略已更新。");
  renderSettings();
}

async function saveAgentSettings() {
  state.projectSettings = normalizeProjectSettings(
    await api(`/api/projects/${state.selectedProjectId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(readAgentSettingsForm())
    })
  );
  syncProjectSettingsToInputs();
  showNotice("操作成功", "Agent 配置已更新。");
  renderSettings();
}

function readAiHealingConfigForm() {
  const body = {
    enableLocatorFallback: Boolean($("ai-enable-fallback")?.checked),
    enableAiHealing: Boolean($("ai-enable-healing")?.checked),
    autoPromoteHealedLocator: Boolean($("ai-auto-promote")?.checked),
    requireManualReview: Boolean($("ai-manual-review")?.checked),
    allowAiOnProd: Boolean($("ai-allow-prod")?.checked),
    aiProvider: $("ai-provider")?.value?.trim() || "openai-compatible",
    aiModel: $("ai-model")?.value?.trim() || "",
    aiBaseUrl: $("ai-base-url")?.value?.trim() || "",
    aiTimeoutMs: Number($("ai-timeout-ms")?.value || 20000),
    maxAiAttempts: Number($("ai-max-attempts")?.value || 1),
    aiLocatorConfidenceThreshold: Number($("ai-locator-confidence-threshold")?.value || 70)
  };
  const apiKey = $("ai-api-key")?.value?.trim();
  if (apiKey) {
    body.apiKey = apiKey;
  }
  return body;
}

function readAiVisualConfigForm() {
  const body = {
    enableAiVisualLocator: Boolean($("ai-enable-visual-locator")?.checked),
    aiVisualProvider: $("ai-visual-provider")?.value?.trim() || "midscene",
    aiVisualModelFamily: $("ai-visual-model-family")?.value?.trim() || "",
    aiVisualModel: $("ai-visual-model")?.value?.trim() || "",
    aiVisualBaseUrl: $("ai-visual-base-url")?.value?.trim() || "",
    aiVisualTimeoutMs: Number($("ai-visual-timeout-ms")?.value || 15000),
    aiVisualMaxAttempts: Number($("ai-visual-max-attempts")?.value || 1)
  };
  const apiKey = $("ai-visual-api-key")?.value?.trim();
  if (apiKey) {
    body.aiVisualApiKey = apiKey;
  }
  return body;
}

function readAiCaptchaConfigForm() {
  const body = {
    enableAiCaptcha: Boolean($("ai-enable-captcha")?.checked),
    aiCaptchaProvider: $("ai-captcha-provider")?.value?.trim() || "",
    aiCaptchaModel: $("ai-captcha-model")?.value?.trim() || "",
    aiCaptchaBaseUrl: $("ai-captcha-base-url")?.value?.trim() || "",
    aiCaptchaTimeoutMs: Number($("ai-captcha-timeout-ms")?.value || 20000),
    captchaConfidenceThreshold: Number($("captcha-confidence-threshold")?.value || 80),
    captchaMaxAttempts: Number($("captcha-max-attempts")?.value || 3)
  };
  const apiKey = $("ai-captcha-api-key")?.value?.trim();
  if (apiKey) {
    body.aiCaptchaApiKey = apiKey;
  }
  return body;
}

function readAiConfigForm(feature = "healing") {
  if (feature === "visual") return readAiVisualConfigForm();
  if (feature === "captcha") return readAiCaptchaConfigForm();
  return readAiHealingConfigForm();
}

async function saveAiConfig(feature = "healing") {
  state.projectAiConfig = await api(`/api/projects/${state.selectedProjectId}/ai-config`, {
    method: "PATCH",
    body: JSON.stringify(readAiConfigForm(feature))
  });
  const featureLabel =
    feature === "visual" ? "AI 视觉定位配置" : feature === "captcha" ? "AI 验证码识别配置" : "AI 自愈定位配置";
  showNotice("操作成功", `${featureLabel}已更新。`);
  renderSettings();
}

async function testAiConfig(feature = "healing") {
  const body = {
    feature,
    ...readAiConfigForm(feature),
    prompt: "请返回 ok=true，并给出一句简短的中文健康检查信息。"
  };
  const result = await api(`/api/projects/${state.selectedProjectId}/ai-config/test`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  const statusText = result.ok ? "模型测试成功" : "模型测试未通过";
  showNotice(
    statusText,
    `Provider：${result.provider || "-"}；Model：${result.model || "-"}；耗时：${result.latencyMs || 0} ms；返回：${result.message || "-"}`
  );
}

async function applyAiHealLog(logId) {
  await api(`/api/locator-heal-logs/${logId}/apply`, { method: "POST" });
  await loadAiHealLogs();
  renderSettings();
}

async function rejectAiHealLog(logId) {
  const confirmed = await confirmAction({
    title: "拒绝 AI Locator",
    message: "确认拒绝这条 AI 自愈结果？",
    confirmText: "拒绝"
  });
  if (!confirmed) return;
  await api(`/api/locator-heal-logs/${logId}/reject`, { method: "POST" });
  await loadAiHealLogs();
  renderSettings();
}

async function addMember() {
  if (!canManageMembers()) return;
  const userId = Number($("member-user-select").value);
  const projectRole = $("member-role-select").value;
  await api(`/api/projects/${state.selectedProjectId}/members`, {
    method: "POST",
    body: JSON.stringify({ userId, projectRole })
  });
  await loadProjectData();
  closeModal("member-create-modal");
  setMemberMessage("成员已添加。");
}

async function createProject() {
  const projectName = $("new-project-name")?.value.trim();
  const projectCode = $("new-project-code")?.value.trim();
  const defaultBaseUrl = $("new-project-url")?.value.trim();
  const description = $("new-project-desc")?.value.trim();
  const initialMemberIds = Array.from($("new-project-members")?.selectedOptions || []).map((option) =>
    Number(option.value)
  );
  if (!projectName || !projectCode) {
    throw new Error("请填写项目名称和项目编码");
  }
  const data = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      projectName,
      projectCode,
      description,
      defaultBaseUrl: defaultBaseUrl || undefined,
      initialMemberIds
    })
  });
  state.selectedProjectId = Number(data.projectId);
  state.selectedEnvironmentId = 0;
  await loadAll();
  closeProjectModal();
}

async function updateProject() {
  const projectId = Number(state.projectEditingId);
  if (!projectId) {
    throw new Error("未找到要编辑的项目");
  }
  const projectName = $("new-project-name")?.value.trim();
  const projectCode = $("new-project-code")?.value.trim();
  const description = $("new-project-desc")?.value.trim();
  const status = Number($("edit-project-status")?.value || 1);
  if (!projectName || !projectCode) {
    throw new Error("请填写项目名称和项目编码");
  }
  await api(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({
      projectName,
      projectCode,
      description: description || null,
      status
    })
  });
  await loadAll();
  closeProjectModal();
}

function openExecutionCreateModal() {
  const settings = currentProjectSettings().execution;
  renderExecutionEnvironmentOptions();
  renderExecutionCaseOptions();
  $("execution-environment-select").value = String(state.selectedEnvironmentId || state.environments[0]?.id || "");
  $("execution-browser-select").value = settings.defaultBrowser;
  $("execution-retries").value = String(settings.defaultRetries);
  $("execution-headless").checked = Boolean(settings.defaultHeadless);
  $("execution-screenshot").checked = true;
  $("execution-video").checked = true;
  openModal("execution-create-modal");
}

function openMemberCreateModal() {
  if (!canManageMembers()) return;
  $("member-role-select").value = "tester";
  openModal("member-create-modal");
}

function openProjectCreateModal() {
  if (!canCreateProject()) return;
  state.projectEditingId = 0;
  setText("project-modal-title", "新建项目");
  setText("project-modal-summary", "创建后将自动授予当前账号项目管理员权限。");
  $("new-project-name").value = "";
  $("new-project-code").value = "";
  $("new-project-url").value = "";
  $("new-project-desc").value = "";
  $("edit-project-status").value = "1";
  $("project-default-url-row").classList.remove("hidden");
  $("project-members-row").classList.remove("hidden");
  $("project-status-row").classList.add("hidden");
  setText("create-project-button", "创建项目");
  Array.from($("new-project-members").options || []).forEach((option) => {
    option.selected = false;
  });
  openModal("project-create-modal");
}

function openProjectEditModal(projectId) {
  const project = state.projects.find((item) => Number(item.id) === Number(projectId));
  if (!project) {
    throw new Error("项目不存在");
  }
  const canManageRowSettings = state.user?.roleCode === "admin" || project.projectRole === "project_admin";
  if (!canManageRowSettings) {
    throw new Error("当前账号没有编辑该项目的权限");
  }
  state.projectEditingId = Number(projectId);
  setText("project-modal-title", "编辑项目");
  setText("project-modal-summary", "更新项目基础信息后会立即同步到项目设置列表。");
  $("new-project-name").value = project.projectName || "";
  $("new-project-code").value = project.projectCode || "";
  $("new-project-url").value = "";
  $("new-project-desc").value = project.description || "";
  $("edit-project-status").value = String(Number(project.status) === 1 ? 1 : 2);
  $("project-default-url-row").classList.add("hidden");
  $("project-members-row").classList.add("hidden");
  $("project-status-row").classList.remove("hidden");
  setText("create-project-button", "保存项目");
  Array.from($("new-project-members").options || []).forEach((option) => {
    option.selected = false;
  });
  openModal("project-create-modal");
}

function closeProjectModal() {
  closeModal("project-create-modal");
  state.projectEditingId = 0;
}

async function saveProjectFromModal() {
  if (state.projectEditingId) {
    await updateProject();
    return;
  }
  await createProject();
}

function openEnvironmentCreateModal() {
  if (!canManageSettings()) return;
  openEnvironmentManageModal(state.selectedProjectId, selectedProject()?.projectName || "").catch((error) => {
    showNotice("操作失败", error.message || String(error));
  });
}

async function updateMember(memberId, patch) {
  await api(`/api/projects/${state.selectedProjectId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
  await loadProjectData();
}

async function removeMember(memberId) {
  await api(`/api/projects/${state.selectedProjectId}/members/${memberId}`, {
    method: "DELETE"
  });
  await loadProjectData();
}

async function deleteJob(jobNo) {
  const confirmed = await confirmAction({
    title: "删除执行任务",
    message: `确认删除任务 ${jobNo}？删除后相关报告产物记录也会删除。`,
    confirmText: "删除"
  });
  if (!confirmed) return;
  await api(`/api/execution-jobs/${encodeURIComponent(jobNo)}`, {
    method: "DELETE"
  });
  if (state.currentModal === "job-detail-modal") {
    closeJobDetail();
  }
  await loadProjectData();
}

async function deleteProject(projectId) {
  const confirmed = await confirmAction({
    title: "删除项目",
    message: "确认删除该项目？",
    confirmText: "删除"
  });
  if (!confirmed) return;
  await api(`/api/projects/${projectId}`, {
    method: "DELETE"
  });
  if (Number(state.selectedProjectId) === Number(projectId)) {
    state.selectedProjectId = 0;
  }
  await loadAll();
}

function switchView(view) {
  const nextView = viewNames.has(view) ? view : "overview";
  state.activeView = nextView;
  localStorage.setItem("tp_active_view", nextView);
  $("status-strip").classList.toggle("hidden", nextView !== "overview");
  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `view-${nextView}`);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.nav === nextView);
  });
}

document.addEventListener("click", async (event) => {
  const clicked = event.target;
  if (!(clicked instanceof HTMLElement)) return;
  const openMenu = clicked.closest(".action-menu");
  closeAllActionMenus(openMenu instanceof HTMLElement ? openMenu : null);
  if (clicked.closest(".action-menu summary")) {
    window.requestAnimationFrame(() => positionActionMenu(openMenu));
  }
  if (clicked.classList.contains("modal-backdrop")) {
    closeModalView(clicked.id);
    return;
  }
  const target = clicked.closest("[data-action], [data-nav]");
  if (!(target instanceof HTMLElement)) return;
  const nav = target.dataset.nav;
  const action = target.dataset.action;
  try {
    if (action === "rename-tree-node") {
      event.preventDefault();
      event.stopPropagation();
      openTreeNodeRenameModal(
        target.dataset.nodeType,
        target.dataset.nodeId,
        target.dataset.currentName || "",
        target.dataset.pageId || "",
        target.dataset.virtual === "1"
      );
      return;
    }
    if (action === "delete-tree-node") {
      event.preventDefault();
      event.stopPropagation();
      await deleteTreeNode(target.dataset.nodeType, target.dataset.nodeId, target.dataset.currentName || "");
      return;
    }
    if (action === "toggle-execution-case") {
      const caseId = Number(target.dataset.caseId);
      if (target.checked) {
        state.selectedExecutionCaseIds = [...state.selectedExecutionCaseIds.filter((id) => Number(id) !== caseId), caseId];
      } else {
        state.selectedExecutionCaseIds = state.selectedExecutionCaseIds.filter((id) => Number(id) !== caseId);
      }
      renderExecutionCasePicker();
      return;
    }
    if (nav) switchView(nav);
    if (action === "materialize") await materialize(target.dataset.session);
    if (action === "paginate") {
      setPageState(target.dataset.key, target.dataset.page);
      if (target.dataset.key === "recording") {
        await loadRecordings();
        renderShell();
      } else if (target.dataset.key === "element") {
        await loadElements();
        renderShell();
      } else if (target.dataset.key === "case") {
        await loadCases();
        renderShell();
      } else if (target.dataset.key === "job") {
        renderJobList();
      } else if (target.dataset.key === "report") {
        renderReports();
      } else if (target.dataset.key === "member") {
        renderMembers();
      } else if (target.dataset.key === "project" || target.dataset.key === "environment") {
        renderSettings();
      } else if (target.dataset.key === "aiHealLog") {
        await loadAiHealLogs();
        renderSettings();
      }
    }
    if (action === "recording-page") {
      state.recordingPage = Number(target.dataset.page);
      await loadRecordings();
      renderShell();
    }
    if (action === "recording-events") {
      state.recordingEventPage = 1;
      await showRecordingEvents(target.dataset.session);
    }
    if (action === "recording-events-page") {
      state.recordingEventPage = Number(target.dataset.page);
      await showRecordingEvents(state.recordingEventSession);
    }
    if (action === "delete-recording") await deleteRecording(target.dataset.session);
    if (action === "select-element-page") {
      state.selectedElementPageId = target.dataset.pageId || "all";
      localStorage.setItem("tp_element_page_id", state.selectedElementPageId);
      await loadElements();
      renderShell();
    }
    if (action === "element-detail") await showElementDetail(Number(target.dataset.elementId));
    if (action === "add-element-locator") openLocatorFormModal();
    if (action === "remove-element-locator-row") {
      const confirmed = await confirmAction({
        title: "删除 Locator",
        message: "确认删除该 Locator？删除后需保存元素才会生效。",
        confirmText: "删除"
      });
      if (!confirmed) return;
      target.closest("tr")?.remove();
      showNotice("操作成功", "Locator 已从当前列表移除，保存元素后生效。");
    }
    if (action === "save-element-locator-row") await saveElementLocatorRow(target.closest("tr"));
    if (action === "save-element") await saveElement();
    if (action === "disable-element") await disableElement(Number(target.dataset.elementId));
    if (action === "run") await runCase(target.dataset.caseId);
    if (action === "case-detail") await showCaseDetail(Number(target.dataset.caseId));
    if (action === "new-case") showNewCaseForm();
    if (action === "save-case") await saveCase();
    if (action === "add-case-step") await addCaseStep();
    if (action === "open-step-element-picker") await openElementPickerModal(Number(target.dataset.stepId));
    if (action === "select-step-element") applyStepElement(Number(target.dataset.elementId));
    if (action === "reset-element-picker") {
      state.elementPickerKeyword = "";
      state.elementPickerPageId = "";
      state.elementPickerComponentId = "";
      renderElementPickerModal();
    }
    if (action === "save-case-step") await saveCaseStep(Number(target.dataset.stepId));
    if (action === "delete-case-step") await deleteCaseStep(Number(target.dataset.stepId));
    if (action === "copy-case") await copyCase(Number(target.dataset.caseId));
    if (action === "delete-case") await deleteCase(Number(target.dataset.caseId));
    if (action === "job") await showJob(target.dataset.jobNo);
    if (action === "job-modal") await showJob(target.dataset.jobNo, { modal: true });
    if (action === "job-rerun") await rerunJob(target.dataset.jobNo, false);
    if (action === "delete-job") await deleteJob(target.dataset.jobNo);
    if (action === "download-report") await downloadReport(target.dataset.jobNo);
    if (action === "artifact-access") {
      await accessArtifact(
        Number(target.dataset.artifactId),
        target.dataset.fileName || "",
        target.dataset.mode || "download"
      );
    }
    if (action === "overview-start-recording") {
      switchView("recordings");
      await startRecording(false);
    }
    if (action === "overview-new-case") showNewCaseForm();
    if (action === "overview-run-cases") {
      switchView("tasks");
      openExecutionCreateModal();
    }
    if (action === "overview-latest-report") {
      if (target.dataset.jobNo) {
        await showJob(target.dataset.jobNo, { modal: true });
      } else {
        switchView("reports");
      }
    }
    if (action === "overview-more") {
      switchView(target.dataset.view || "overview");
    }
    if (action === "select-project") {
      state.selectedProjectId = Number(target.dataset.projectId);
      state.selectedEnvironmentId = 0;
      resetListPages();
      localStorage.setItem("tp_project_id", String(state.selectedProjectId));
      await loadProjectData();
    }
    if (action === "manage-project-environments") {
      await openEnvironmentManageModal(Number(target.dataset.projectId), target.dataset.projectName || "");
    }
    if (action === "manage-project-modules") {
      await openModuleManageModal(Number(target.dataset.projectId), target.dataset.projectName || "");
    }
    if (action === "settings-tab") {
      state.settingsTab = target.dataset.tab || "projects";
      localStorage.setItem("tp_settings_tab", state.settingsTab);
      if (["strategy", "agent"].includes(state.settingsTab)) {
        await loadProjectSettings().catch(() => {});
      }
      if (["aiHealing", "aiVisual", "aiCaptcha"].includes(state.settingsTab)) {
        await loadProjectAiConfig().catch(() => {});
      }
      if (state.settingsTab === "aiLogs") {
        await loadAiHealLogs().catch(() => {});
      }
      renderSettings();
    }
    if (action === "save-strategy-settings") await saveStrategySettings();
    if (action === "save-agent-settings") await saveAgentSettings();
    if (action === "check-agent-settings") await checkAgent().catch((error) => setAgentMessage(error.message));
    if (action === "save-ai-healing") await saveAiConfig("healing");
    if (action === "test-ai-healing") await testAiConfig("healing");
    if (action === "save-ai-visual") await saveAiConfig("visual");
    if (action === "test-ai-visual") await testAiConfig("visual");
    if (action === "save-ai-captcha") await saveAiConfig("captcha");
    if (action === "test-ai-captcha") await testAiConfig("captcha");
    if (action === "search-ai-heal-logs") {
      state.aiHealLogPage = 1;
      await loadAiHealLogs();
      renderSettings();
    }
    if (action === "reset-ai-heal-logs") {
      $("ai-heal-keyword").value = "";
      $("ai-heal-status").value = "";
      state.aiHealLogPage = 1;
      await loadAiHealLogs();
      renderSettings();
    }
    if (action === "apply-ai-heal-log") await applyAiHealLog(Number(target.dataset.logId));
    if (action === "reject-ai-heal-log") await rejectAiHealLog(Number(target.dataset.logId));
    if (action === "open-managed-environment-form") {
      openManagedEnvironmentForm(0);
    }
    if (action === "open-execution-modal") openExecutionCreateModal();
    if (action === "add-execution-case") addExecutionCase(Number(target.dataset.caseId));
    if (action === "remove-execution-case") removeExecutionCase(Number(target.dataset.caseId));
    if (action === "move-execution-case") moveExecutionCase(Number(target.dataset.caseId), Number(target.dataset.direction));
    if (action === "open-member-modal") openMemberCreateModal();
    if (action === "open-project-modal") openProjectCreateModal();
    if (action === "open-environment-modal") openEnvironmentCreateModal();
    if (action === "create-project") await createProject();
    if (action === "edit-project") openProjectEditModal(Number(target.dataset.projectId));
    if (action === "delete-project") await deleteProject(Number(target.dataset.projectId));
    if (action === "edit-managed-environment") editManagedEnvironment(Number(target.dataset.environmentId));
    if (action === "reset-environment-form") resetEnvironmentManageForm();
    if (action === "save-managed-environment") await saveManagedEnvironment();
    if (action === "delete-managed-environment") await deleteManagedEnvironment(Number(target.dataset.environmentId));
    if (action === "open-project-module-form") openModuleFormModal(Number(target.dataset.moduleId || 0));
    if (action === "save-project-module-form") await saveProjectModuleForm();
    if (action === "save-project-module") await saveProjectModule(Number(target.dataset.moduleId));
    if (action === "delete-project-module") await deleteProjectModule(Number(target.dataset.moduleId));
    if (action === "disable-member") await updateMember(Number(target.dataset.memberId), { status: "disabled" });
    if (action === "remove-member") await removeMember(Number(target.dataset.memberId));
  } catch (error) {
    showNotice("操作失败", error.message || String(error));
  }
});

document.addEventListener("dblclick", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const row = target.closest("tr[data-element-id]");
  if (!(row instanceof HTMLElement)) return;
  try {
    await showElementDetail(Number(row.dataset.elementId));
  } catch (error) {
    showNotice("操作失败", error.message || String(error));
  }
});

document.addEventListener(
  "toggle",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement)) return;
    if (target.dataset.treeLevel === "page") {
      if (target.open) {
        state.elementTreeOpenPages.add(target.dataset.treeKey || "");
      } else {
        state.elementTreeOpenPages.delete(target.dataset.treeKey || "");
      }
    }
    if (target.dataset.treeLevel === "component") {
      if (target.open) {
        state.elementTreeOpenComponents.add(target.dataset.treeKey || "");
      } else {
        state.elementTreeOpenComponents.delete(target.dataset.treeKey || "");
      }
    }
    if (target.classList.contains("action-menu")) {
      positionActionMenu(target);
    }
  },
  true
);

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  try {
    if (target.id === "locator-form-type") {
      syncLocatorFormExpression();
      return;
    }
    if (target.dataset.field === "locatorType") {
      syncElementLocatorRowExpression(target.closest("tr"));
      return;
    }
    if (target.id === "edit-element-page") {
      syncElementComponentOptions();
      return;
    }
    if (target.id === "element-picker-page") {
      state.elementPickerPageId = target.value;
      state.elementPickerComponentId = "";
      renderElementPickerModal();
      return;
    }
    if (target.id === "element-picker-component") {
      state.elementPickerComponentId = target.value;
      renderElementPickerModal();
      return;
    }
    if (target.id === "execution-module-filter") {
      state.executionCaseModuleFilter = target.value;
      renderExecutionCasePicker();
      return;
    }
    if (target.dataset.action === "change-case-group") {
      await api(`/api/test-cases/${Number(target.dataset.caseId)}`, {
        method: "PATCH",
        body: JSON.stringify({ caseGroupId: target.value ? Number(target.value) : null })
      });
      await loadCases();
      renderShell();
      return;
    }
    if (target.dataset.action === "change-member-role") {
      await updateMember(Number(target.dataset.memberId), { projectRole: target.value });
    }
  } catch (error) {
    showNotice("操作失败", error.message || String(error));
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id === "locator-form-value") {
    syncLocatorFormExpression();
    return;
  }
  if (target.dataset.field === "locatorValue") {
    syncElementLocatorRowExpression(target.closest("tr"));
    return;
  }
  if (target.id === "element-picker-keyword") {
    state.elementPickerKeyword = target.value;
    const cursor = target.selectionStart || state.elementPickerKeyword.length;
    renderElementPickerModal();
    const nextInput = $("element-picker-keyword");
    if (nextInput instanceof HTMLInputElement) {
      nextInput.focus();
      nextInput.setSelectionRange(cursor, cursor);
    }
  }
});

document.addEventListener("mouseover", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const cell = target.closest(".data-table th, .data-table td");
  if (cell instanceof HTMLElement) {
    showCellTooltip(cell, event);
  }
});

document.addEventListener("mousemove", (event) => {
  moveCellTooltip(event);
});

document.addEventListener("mouseout", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest(".data-table th, .data-table td")) {
    hideCellTooltip();
  }
});

$("login-button").addEventListener("click", () => login().catch((error) => showLogin(error.message)));
$("sidebar-toggle").addEventListener("click", () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("tp_sidebar_collapsed", state.sidebarCollapsed ? "1" : "0");
  applySidebarState();
});
$("logout-button").addEventListener("click", () => {
  localStorage.removeItem("tp_token");
  state.token = "";
  state.user = null;
  showLogin();
});
$("refresh-button").addEventListener("click", () => loadAll().catch((error) => showNotice("操作失败", error.message)));
$("agent-health-button").addEventListener("click", () =>
  checkAgent().catch((error) => setAgentMessage(error.message))
);
$("start-recording-button").addEventListener("click", () =>
  startRecording(false).catch((error) => setAgentMessage(error.message))
);
$("stop-recording-button").addEventListener("click", () =>
  stopRecording().catch((error) => setAgentMessage(error.message))
);
$("project-select").addEventListener("change", async (event) => {
  state.selectedProjectId = Number(event.target.value);
  state.selectedEnvironmentId = 0;
  resetListPages();
  state.selectedElementPageId = "all";
  localStorage.setItem("tp_element_page_id", "all");
  localStorage.setItem("tp_project_id", String(state.selectedProjectId));
  await loadProjectData();
});
$("environment-select").addEventListener("change", (event) => {
  state.selectedEnvironmentId = Number(event.target.value);
  syncRecordingUrlWithEnvironment(true);
});
$("new-element-button")?.addEventListener("click", showNewElementForm);
$("element-search-button").addEventListener("click", () => {
  state.elementPage = 1;
  loadElements().then(renderShell).catch((error) => showNotice("操作失败", error.message));
});
$("element-tree-toggle").addEventListener("click", () => {
  state.elementTreeCollapsed = !state.elementTreeCollapsed;
  localStorage.setItem("tp_element_tree_collapsed", state.elementTreeCollapsed ? "1" : "0");
  applyElementTreeState();
});
$("element-reset-button").addEventListener("click", () => {
  $("element-keyword").value = "";
  $("element-valid-filter").value = "";
  state.selectedElementPageId = "all";
  localStorage.setItem("tp_element_page_id", "all");
  state.elementPage = 1;
  loadElements().then(renderShell).catch((error) => showNotice("操作失败", error.message));
});
$("case-search-button").addEventListener("click", () => {
  state.casePage = 1;
  loadCases().then(renderShell).catch((error) => showNotice("操作失败", error.message));
});
$("case-reset-button").addEventListener("click", () => {
  $("case-keyword").value = "";
  $("case-group-filter").value = "";
  state.casePage = 1;
  loadCases().then(renderShell).catch((error) => showNotice("操作失败", error.message));
});
$("case-create-execution-button")?.addEventListener("click", () => {
  switchView("tasks");
  openExecutionCreateModal();
});
$("new-case-button").addEventListener("click", showNewCaseForm);
$("open-execution-modal-button").addEventListener("click", openExecutionCreateModal);
$("job-search-button").addEventListener("click", () => {
  state.jobPage = 1;
  renderJobList();
});
$("job-reset-button").addEventListener("click", () => {
  $("job-keyword").value = "";
  $("job-status-filter").value = "";
  state.jobPage = 1;
  renderJobList();
});
$("create-execution-button").addEventListener("click", () =>
  createExecutionJobFromForm().catch((error) => showNotice("操作失败", error.message))
);
$("execution-case-up")?.addEventListener("click", () => moveSelectedExecutionCase(-1));
$("execution-case-down")?.addEventListener("click", () => moveSelectedExecutionCase(1));
$("report-filter-button").addEventListener("click", () => {
  state.reportPage = 1;
  renderReports();
});
$("report-reset-button").addEventListener("click", () => {
  $("report-from").value = "";
  $("report-to").value = "";
  $("report-executor").value = "";
  $("report-pass-rate").value = "";
  state.reportPage = 1;
  renderReports();
});
$("recording-filter-button").addEventListener("click", () => {
  state.recordingPage = 1;
  loadRecordings().then(renderShell).catch((error) => showNotice("操作失败", error.message));
});
$("recording-reset-button").addEventListener("click", () => {
  $("recording-status-filter").value = "";
  state.recordingPage = 1;
  loadRecordings().then(renderShell).catch((error) => showNotice("操作失败", error.message));
});
$("member-search-button").addEventListener("click", () => {
  state.memberPage = 1;
  renderMembers();
});
$("member-reset-button").addEventListener("click", () => {
  $("member-keyword").value = "";
  $("member-status-filter").value = "";
  $("member-role-filter").value = "";
  state.memberPage = 1;
  renderMembers();
});
$("open-member-modal-button").addEventListener("click", openMemberCreateModal);
$("add-member-button").addEventListener("click", () => addMember().catch((error) => setMemberMessage(error.message)));
$("open-project-modal-button")?.addEventListener("click", openProjectCreateModal);
$("create-project-button").addEventListener("click", () => saveProjectFromModal().catch((error) => showNotice("操作失败", error.message)));
$("recording-event-close").addEventListener("click", closeRecordingEvents);
$("materialize-notice-close").addEventListener("click", closeMaterializeNotice);
$("app-notice-close")?.addEventListener("click", closeNotice);
$("app-confirm-close")?.addEventListener("click", () => closeConfirm(false));
$("app-confirm-cancel")?.addEventListener("click", () => closeConfirm(false));
$("app-confirm-ok")?.addEventListener("click", () => closeConfirm(true));
$("element-detail-close").addEventListener("click", closeElementDetail);
$("locator-form-close")?.addEventListener("click", closeLocatorFormModal);
$("locator-form-cancel")?.addEventListener("click", closeLocatorFormModal);
$("locator-form-save")?.addEventListener("click", () =>
  Promise.resolve(addElementLocator()).catch((error) => showNotice("操作失败", error.message || String(error)))
);
$("tree-node-modal-close").addEventListener("click", closeTreeNodeModal);
$("tree-node-save-button").addEventListener("click", () => saveTreeNodeName().catch((error) => showNotice("操作失败", error.message)));
$("case-detail-close").addEventListener("click", closeCaseDetail);
$("element-picker-close")?.addEventListener("click", closeElementPickerModal);
$("job-detail-close").addEventListener("click", closeJobDetail);
$("execution-create-close").addEventListener("click", () => closeModal("execution-create-modal"));
$("member-create-close").addEventListener("click", () => closeModal("member-create-modal"));
$("project-create-close").addEventListener("click", closeProjectModal);
$("environment-manage-close").addEventListener("click", () => closeModal("environment-manage-modal"));
$("environment-form-close").addEventListener("click", closeEnvironmentFormModal);
$("module-manage-close")?.addEventListener("click", () => closeModalView("module-manage-modal"));
$("module-form-close")?.addEventListener("click", closeModuleFormModal);
$("tree-node-name-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveTreeNodeName().catch((error) => showNotice("操作失败", error.message));
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id === "settings-search-button") {
    state.projectPage = 1;
    renderSettings();
  }
  if (target.id === "settings-reset-button") {
    const keyword = $("settings-project-keyword");
    const status = $("settings-project-status");
    if (keyword) keyword.value = "";
    if (status) status.value = "";
    state.projectPage = 1;
    renderSettings();
  }
});

if (state.token) {
  showDashboard();
  loadAll().catch(() => showLogin("登录已过期，请重新登录"));
} else {
  showLogin();
}

setInterval(() => {
  if (state.token && currentProjectSettings().agent.autoCheckOnLoad !== false) {
    checkAgent(true).catch(() => {});
  }
}, 5000);

window.addEventListener("resize", positionOpenActionMenus);
document.addEventListener("scroll", positionOpenActionMenus, true);

const tableTitleObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (!(mutation.target instanceof HTMLElement)) continue;
    if (mutation.target.closest(".data-table") || mutation.target.querySelector?.(".data-table")) {
      refreshTableCellTitles(mutation.target);
    }
  }
});
tableTitleObserver.observe(document.body, { childList: true, subtree: true });








