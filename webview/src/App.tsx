import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useAppStore,
  type ChangeView,
  type ChatItem,
  type ChatMode,
  type ProviderView,
} from "./store";
import { vscode } from "./vscode";

const modes: readonly {
  value: ChatMode;
  label: string;
  description: string;
}[] = [
  { value: "ask", label: "问答", description: "只读回答与解释" },
  { value: "plan", label: "规划", description: "分析项目并制定方案" },
  { value: "agent", label: "执行", description: "生成可审核的文件修改" },
];

export function App(): React.JSX.Element {
  const viewKind = useAppStore((state) => state.viewKind);
  const handleMessage = useAppStore((state) => state.handleMessage);

  useEffect(() => {
    const listener = (event: MessageEvent<unknown>): void => {
      handleMessage(event.data);
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ type: "view/ready", viewKind });
    return () => window.removeEventListener("message", listener);
  }, [handleMessage, viewKind]);

  return (
    <main className="app">
      <Notice />
      {viewKind === "models" ? <ModelsView /> : <Workbench />}
    </main>
  );
}

function Notice(): React.JSX.Element | null {
  const notice = useAppStore((state) => state.notice);
  const clear = useAppStore((state) => state.clearNotice);
  if (!notice) {
    return null;
  }
  return (
    <button
      type="button"
      className={`notice ${notice.level}`}
      onClick={clear}
      aria-label="关闭提示"
    >
      <span>{notice.message}</span>
      <span aria-hidden="true">×</span>
    </button>
  );
}

function Workbench(): React.JSX.Element {
  const navigation = useAppStore((state) => state.navigation);
  const setNavigation = useAppStore((state) => state.setNavigation);
  const provider = useAppStore((state) => state.provider);
  const changes = useAppStore((state) => state.changes);
  const workspaceTrusted = useAppStore((state) => state.workspaceTrusted);
  const pendingCount = changes.filter((change) => change.status === "pending").length;

  return (
    <>
      <header className="workbench-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            AI
          </span>
          <div>
            <h1>AI 编程助手</h1>
            <p className={workspaceTrusted ? "status-ok" : "status-warning"}>
              {workspaceTrusted ? "工作区已受信任" : "受限模式"}
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="model-button"
            title="打开模型设置"
            onClick={() => vscode.postMessage({ type: "ui/open-settings" })}
          >
            <span className="model-status" data-ready={provider?.hasApiKey === true} />
            {provider?.modelId || "配置模型"}
          </button>
          <button
            type="button"
            className="icon-button"
            title="模型与安全设置"
            aria-label="模型与安全设置"
            onClick={() => vscode.postMessage({ type: "ui/open-settings" })}
          >
            ⚙
          </button>
        </div>
      </header>

      <nav className="navigation" aria-label="功能导航">
        <button
          type="button"
          className={navigation === "chat" ? "active" : ""}
          onClick={() => setNavigation("chat")}
        >
          对话
        </button>
        <button
          type="button"
          className={navigation === "project" ? "active" : ""}
          onClick={() => setNavigation("project")}
        >
          项目
        </button>
        <button
          type="button"
          className={navigation === "changes" ? "active" : ""}
          onClick={() => setNavigation("changes")}
        >
          变更{pendingCount > 0 ? <span className="count">{pendingCount}</span> : null}
        </button>
      </nav>

      {navigation === "chat" && <ChatView />}
      {navigation === "project" && <ProjectView />}
      {navigation === "changes" && <ChangesView />}
    </>
  );
}

function ChatView(): React.JSX.Element {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>("ask");
  const [includeActiveEditor, setIncludeActiveEditor] = useState(true);
  const [includeWorkspace, setIncludeWorkspace] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const messages = useAppStore((state) => state.messages);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const activeSession = useAppStore((state) => state.activeSession);
  const prefill = useAppStore((state) => state.prefill);
  const consumePrefill = useAppStore((state) => state.consumePrefill);
  const workspaceTrusted = useAppStore((state) => state.workspaceTrusted);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefill) {
      // The prefill originates outside React in the Extension Host.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(prefill.text);
      setMode(prefill.mode);
      consumePrefill();
    }
  }, [consumePrefill, prefill]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = (event?: FormEvent): void => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || activeRequestId || !activeSession) {
      return;
    }
    vscode.postMessage({
      type: "chat/send",
      requestId: crypto.randomUUID(),
      sessionId: activeSession.id,
      text: value,
      mode,
      includeActiveEditor,
      includeWorkspace,
    });
    setText("");
  };

  const reuse = (message: ChatItem): void => {
    setText(message.text);
    if (message.mode) {
      setMode(message.mode);
    }
  };

  const applyTemplate = (template: string, nextMode: ChatMode, workspace = false): void => {
    setText(template);
    setMode(nextMode);
    if (workspace) {
      setIncludeWorkspace(true);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <section className="chat-layout">
      <SessionToolbar />

      <div className="messages" aria-live="polite">
        {messages.length === 0 && (
          <EmptyChat applyTemplate={applyTemplate} providerReady={Boolean(activeSession)} />
        )}
        {messages.map((message) => (
          <MessageCard key={message.id} message={message} onReuse={() => reuse(message)} />
        ))}
        <div ref={endRef} />
      </div>

      {showContext && <ContextPanel setText={setText} />}

      <form className="composer" onSubmit={send}>
        <div className="mode-switcher" aria-label="工作模式">
          {modes.map((item) => (
            <button
              key={item.value}
              type="button"
              className={mode === item.value ? "active" : ""}
              title={item.description}
              onClick={() => setMode(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="context-chips">
          <button
            type="button"
            className={includeActiveEditor ? "chip active" : "chip"}
            onClick={() => setIncludeActiveEditor((value) => !value)}
            aria-pressed={includeActiveEditor}
          >
            当前文件/选区
            {includeActiveEditor ? " ×" : " +"}
          </button>
          <button
            type="button"
            className={includeWorkspace ? "chip active" : "chip"}
            onClick={() => setIncludeWorkspace((value) => !value)}
            aria-pressed={includeWorkspace}
          >
            项目结构
            {includeWorkspace ? " ×" : " +"}
          </button>
          <button type="button" className="chip" onClick={() => setShowContext((value) => !value)}>
            {showContext ? "收起上下文" : "＋ 添加上下文"}
          </button>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            mode === "ask"
              ? "询问代码、错误或实现方式…"
              : mode === "plan"
                ? "描述目标，AI 将先分析并制定计划…"
                : "描述任务，所有修改都需要审核后应用…"
          }
          rows={4}
          aria-label="任务描述"
        />
        <div className="composer-footer">
          <span>Enter 发送 · Shift+Enter 换行</span>
          {activeRequestId ? (
            <button
              type="button"
              className="danger"
              onClick={() =>
                vscode.postMessage({
                  type: "chat/cancel",
                  requestId: activeRequestId,
                })
              }
            >
              停止生成
            </button>
          ) : (
            <button
              type="submit"
              className="primary send-button"
              disabled={!text.trim() || !workspaceTrusted || !activeSession}
            >
              发送
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function SessionToolbar(): React.JSX.Element {
  const sessions = useAppStore((state) => state.sessions);
  const activeSession = useAppStore((state) => state.activeSession);
  const activeRequestId = useAppStore((state) => state.activeRequestId);

  const rename = (): void => {
    if (!activeSession) {
      return;
    }
    const title = window.prompt("输入新的对话名称", activeSession.title)?.trim();
    if (title) {
      vscode.postMessage({
        type: "session/rename",
        sessionId: activeSession.id,
        title,
      });
    }
  };

  const remove = (): void => {
    if (!activeSession || !window.confirm(`确认删除对话“${activeSession.title}”？`)) {
      return;
    }
    vscode.postMessage({ type: "session/delete", sessionId: activeSession.id });
  };

  return (
    <div className="session-toolbar">
      <select
        value={activeSession?.id ?? ""}
        onChange={(event) =>
          vscode.postMessage({ type: "session/select", sessionId: event.target.value })
        }
        disabled={Boolean(activeRequestId)}
        aria-label="历史对话"
      >
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.title} · {session.messageCount}
          </option>
        ))}
      </select>
      <button
        type="button"
        title="新建对话"
        onClick={() => vscode.postMessage({ type: "session/new" })}
        disabled={Boolean(activeRequestId)}
      >
        ＋ 新对话
      </button>
      <button type="button" className="icon-button" title="重命名" onClick={rename}>
        ✎
      </button>
      <button type="button" className="icon-button danger" title="删除对话" onClick={remove}>
        ×
      </button>
    </div>
  );
}

function EmptyChat({
  applyTemplate,
  providerReady,
}: {
  readonly applyTemplate: (template: string, mode: ChatMode, workspace?: boolean) => void;
  readonly providerReady: boolean;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        ✦
      </div>
      <h2>从一个真实开发任务开始</h2>
      <p>
        {providerReady
          ? "选择上下文和工作模式，AI 会在修改前让你审核。"
          : "正在初始化对话，请稍候…"}
      </p>
      <div className="template-grid">
        <button
          type="button"
          onClick={() => applyTemplate("解释当前文件的主要职责和关键逻辑。", "ask")}
        >
          <strong>解释当前代码</strong>
          <span>快速理解当前文件</span>
        </button>
        <button
          type="button"
          onClick={() =>
            applyTemplate(
              "分析当前项目的技术栈、目录结构、核心模块、启动方式和潜在风险。",
              "plan",
              true,
            )
          }
        >
          <strong>分析整个项目</strong>
          <span>先理解再制定计划</span>
        </button>
        <button
          type="button"
          onClick={() => applyTemplate("审查当前文件，按严重程度列出问题和改进建议。", "plan")}
        >
          <strong>代码审查</strong>
          <span>发现缺陷与风险</span>
        </button>
        <button
          type="button"
          onClick={() =>
            applyTemplate(
              "为当前文件补充单元测试。复用项目现有测试框架，并生成可审核的修改。",
              "agent",
            )
          }
        >
          <strong>生成单元测试</strong>
          <span>修改前查看 Diff</span>
        </button>
      </div>
    </div>
  );
}

function MessageCard({
  message,
  onReuse,
}: {
  readonly message: ChatItem;
  readonly onReuse: () => void;
}): React.JSX.Element {
  const copy = (): void => {
    void navigator.clipboard.writeText(message.text);
  };
  return (
    <article className={`message ${message.role} ${message.error ? "error" : ""}`}>
      <div className="message-header">
        <div>
          <span className="avatar">{message.role === "user" ? "你" : "AI"}</span>
          <strong>{message.role === "user" ? "你" : "AI 编程助手"}</strong>
          {message.mode && <small>{modes.find((item) => item.value === message.mode)?.label}</small>}
        </div>
        <div className="message-actions">
          {message.role === "user" && (
            <button type="button" onClick={onReuse}>
              再次使用
            </button>
          )}
          <button type="button" onClick={copy} disabled={!message.text}>
            复制
          </button>
        </div>
      </div>
      {message.pending && !message.text ? (
        <div className="thinking">
          <span />
          <span />
          <span />
          正在生成
        </div>
      ) : (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        </div>
      )}
      {message.error && (
        <button
          type="button"
          className="secondary"
          onClick={() => vscode.postMessage({ type: "ui/open-settings" })}
        >
          检查模型设置
        </button>
      )}
    </article>
  );
}

function ContextPanel({
  setText,
}: {
  readonly setText: React.Dispatch<React.SetStateAction<string>>;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const results = useAppStore((state) => state.searchResults);
  return (
    <section className="context-panel">
      <div>
        <strong>添加项目文件</strong>
        <span>搜索结果只来自当前受信任工作区，敏感路径会被过滤。</span>
      </div>
      <div className="inline">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索代码内容，至少 2 个字符"
        />
        <button
          type="button"
          onClick={() => vscode.postMessage({ type: "workspace/search", query: search })}
          disabled={search.trim().length < 2}
        >
          搜索
        </button>
      </div>
      <div className="context-results">
        {results.slice(0, 12).map((result) => (
          <button
            type="button"
            key={`${result.uri}:${result.line}`}
            onClick={() =>
              setText((value) =>
                `${value}${value.trim() ? "\n" : ""}@file(${result.relativePath})`,
              )
            }
          >
            <strong>
              {result.relativePath}:{result.line + 1}
            </strong>
            <span>{result.preview}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProjectView(): React.JSX.Element {
  const overview = useAppStore((state) => state.projectOverview);
  const analyzing = useAppStore((state) => state.projectAnalyzing);
  const workspaceTrusted = useAppStore((state) => state.workspaceTrusted);

  return (
    <section className="content-view">
      <div className="section-heading">
        <div>
          <h2>项目概览</h2>
          <p>本地扫描项目结构，不读取敏感路径，也不会将扫描结果自动发送到模型。</p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={analyzing || !workspaceTrusted}
          onClick={() => vscode.postMessage({ type: "project/analyze" })}
        >
          {analyzing ? "正在分析…" : overview ? "重新分析" : "分析项目"}
        </button>
      </div>

      {!overview && (
        <div className="empty-state compact">
          <div className="empty-icon">⌘</div>
          <h2>建立当前项目画像</h2>
          <p>识别技术栈、模块、入口、测试、脚本与配置文件，为后续规划提供依据。</p>
        </div>
      )}

      {overview && (
        <>
          <div className="metric-grid">
            <Metric label="项目" value={overview.workspaceName} />
            <Metric label="文件" value={String(overview.fileCount)} />
            <Metric label="测试文件" value={String(overview.testFileCount)} />
            <Metric label="包管理器" value={overview.packageManagers.join("、") || "未识别"} />
          </div>
          {overview.warnings.map((warning) => (
            <div className="warning-card" key={warning}>
              {warning}
            </div>
          ))}
          <OverviewSection title="技术栈">
            <TagList values={overview.technologies} empty="暂未识别" />
          </OverviewSection>
          <OverviewSection title="主要语言">
            <div className="language-list">
              {overview.languages.map((language) => (
                <div key={language.name}>
                  <span>{language.name}</span>
                  <strong>{language.count}</strong>
                </div>
              ))}
            </div>
          </OverviewSection>
          <OverviewSection title="主要模块">
            <TagList values={overview.modules} empty="根目录暂无明显模块" />
          </OverviewSection>
          <OverviewSection title="入口文件">
            <PathList values={overview.entryFiles} />
          </OverviewSection>
          <OverviewSection title="配置文件">
            <PathList values={overview.configurationFiles} />
          </OverviewSection>
          <OverviewSection title="可用脚本">
            {Object.keys(overview.scripts).length === 0 ? (
              <p className="muted">未识别到 package.json 脚本。</p>
            ) : (
              <div className="script-list">
                {Object.entries(overview.scripts).map(([name, command]) => (
                  <div key={name}>
                    <strong>{name}</strong>
                    <code>{command}</code>
                  </div>
                ))}
              </div>
            )}
          </OverviewSection>
          <p className="analyzed-at">
            分析时间：{new Date(overview.analyzedAt).toLocaleString("zh-CN")}
          </p>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OverviewSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="overview-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function TagList({
  values,
  empty,
}: {
  readonly values: readonly string[];
  readonly empty: string;
}): React.JSX.Element {
  if (values.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  return (
    <div className="tag-list">
      {values.map((value) => (
        <span key={value}>{value}</span>
      ))}
    </div>
  );
}

function PathList({ values }: { readonly values: readonly string[] }): React.JSX.Element {
  if (values.length === 0) {
    return <p className="muted">暂未识别。</p>;
  }
  return (
    <ul className="path-list">
      {values.map((value) => (
        <li key={value}>
          <code>{value}</code>
        </li>
      ))}
    </ul>
  );
}

function ChangesView(): React.JSX.Element {
  const changes = useAppStore((state) => state.changes);
  const testResult = useAppStore((state) => state.testResult);
  const testRunning = useAppStore((state) => state.testRunning);
  const visibleChanges = useMemo(
    () => changes.filter((change) => change.status !== "rejected"),
    [changes],
  );
  const pendingCount = visibleChanges.filter((change) => change.status === "pending").length;
  const appliedCount = visibleChanges.filter((change) => change.status === "applied").length;

  return (
    <section className="content-view">
      <div className="section-heading">
        <div>
          <h2>变更审核</h2>
          <p>AI 生成的修改只有经过 Diff 审核和明确批准后才会写入工作区。</p>
        </div>
        <button
          type="button"
          onClick={() => vscode.postMessage({ type: "test/run" })}
          disabled={testRunning}
        >
          {testRunning ? "测试运行中…" : "运行测试"}
        </button>
      </div>

      <div className="metric-grid two">
        <Metric label="待审核" value={String(pendingCount)} />
        <Metric label="已应用" value={String(appliedCount)} />
      </div>

      {visibleChanges.length === 0 ? (
        <div className="empty-state compact">
          <div className="empty-icon">✓</div>
          <h2>当前没有 AI 变更</h2>
          <p>在“执行”模式下生成修改后，将在这里集中审核。</p>
        </div>
      ) : (
        <div className="change-list">
          {visibleChanges.map((change) => (
            <ChangeCard key={change.id} change={change} />
          ))}
        </div>
      )}

      {testResult && (
        <section className={`test-card ${testResult.exitCode === 0 ? "success" : "failed"}`}>
          <div>
            <h3>{testResult.exitCode === 0 ? "测试通过" : "测试失败"}</h3>
            <span>
              {testResult.command} · {testResult.durationMs} ms · 退出码{" "}
              {testResult.exitCode ?? "未知"}
            </span>
          </div>
          <pre>{testResult.output.slice(-8_000)}</pre>
        </section>
      )}
    </section>
  );
}

function ChangeCard({ change }: { readonly change: ChangeView }): React.JSX.Element {
  const statusNames: Readonly<Record<ChangeView["status"], string>> = {
    pending: "待审核",
    approved: "已批准",
    applied: "已应用",
    rejected: "已拒绝",
    conflicted: "存在冲突",
    failed: "应用失败",
  };
  return (
    <article className="change-card">
      <div className="change-heading">
        <div>
          <strong>{change.path}</strong>
          <span>{change.operation === "create" ? "新建文件" : "更新文件"}</span>
        </div>
        <span className={`status-pill ${change.status}`}>{statusNames[change.status]}</span>
      </div>
      {change.reason && <p>{change.reason}</p>}
      {change.error && <p className="error-text">{change.error}</p>}
      <div className="actions">
        <button
          type="button"
          onClick={() => vscode.postMessage({ type: "change/preview", changeId: change.id })}
        >
          查看 Diff
        </button>
        {change.status === "pending" && (
          <>
            <button
              type="button"
              className="primary"
              onClick={() => vscode.postMessage({ type: "change/apply", changeId: change.id })}
            >
              审核并应用
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => vscode.postMessage({ type: "change/reject", changeId: change.id })}
            >
              拒绝
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function ModelsView(): React.JSX.Element {
  const provider = useAppStore((state) => state.provider);
  return <ModelsForm key={provider?.updatedAt ?? "unconfigured"} provider={provider} />;
}

function ModelsForm({
  provider,
}: {
  readonly provider: ProviderView | undefined;
}): React.JSX.Element {
  const [form, setForm] = useState(() => providerToForm(provider));
  const [apiKey, setApiKey] = useState("");

  const save = (event: FormEvent): void => {
    event.preventDefault();
    vscode.postMessage({
      type: "provider/save",
      displayName: form.displayName,
      baseUrl: form.baseUrl,
      modelId: form.modelId,
      timeoutMs: Number(form.timeoutMs),
      ...(apiKey.trim() ? { apiKey } : {}),
    });
    if (apiKey.trim()) {
      setApiKey("");
    }
  };

  return (
    <section className="content-view settings-view">
      <div className="section-heading">
        <div>
          <h1>模型与安全设置</h1>
          <p>OpenAI Compatible · 密钥仅保存到 VS Code SecretStorage</p>
        </div>
        <span className={`connection-badge ${provider?.hasApiKey ? "ready" : ""}`}>
          {provider?.hasApiKey ? "已配置" : "未配置"}
        </span>
      </div>
      <form className="settings" onSubmit={save}>
        <label>
          <span>配置名称</span>
          <input
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Base URL</span>
          <input
            value={form.baseUrl}
            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            placeholder="https://example.com/v1"
            required
          />
          <small>通常填写兼容服务的 /v1 地址，也可直接填写 /chat/completions。</small>
        </label>
        <label>
          <span>Model ID</span>
          <input
            value={form.modelId}
            onChange={(event) => setForm({ ...form, modelId: event.target.value })}
            placeholder="模型服务提供的准确 ID"
            required
          />
        </label>
        <label>
          <span>请求超时（毫秒）</span>
          <input
            type="number"
            min={5000}
            max={600000}
            value={form.timeoutMs}
            onChange={(event) => setForm({ ...form, timeoutMs: event.target.value })}
            required
          />
        </label>
        <label>
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider?.hasApiKey ? "已安全配置；留空表示不修改" : "请输入 API Key"}
            autoComplete="off"
          />
          <small>插件不会把密钥写入 settings.json、日志或工作区文件。</small>
        </label>
        <div className="security-note">
          <strong>密钥状态：{provider?.hasApiKey ? "已安全配置" : "未配置"}</strong>
          <span>工作区内容会经过敏感路径过滤，文件修改始终需要审核。</span>
        </div>
        <div className="actions">
          <button type="submit" className="primary">
            保存配置
          </button>
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: "provider/test" })}
            disabled={!provider?.hasApiKey}
          >
            测试连接
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => vscode.postMessage({ type: "provider/clear-key" })}
            disabled={!provider?.hasApiKey}
          >
            移除密钥
          </button>
        </div>
      </form>
    </section>
  );
}

function providerToForm(provider?: ProviderView): {
  displayName: string;
  baseUrl: string;
  modelId: string;
  timeoutMs: string;
} {
  return {
    displayName: provider?.displayName ?? "OpenAI Compatible",
    baseUrl: provider?.baseUrl ?? "",
    modelId: provider?.modelId ?? "",
    timeoutMs: String(provider?.timeoutMs ?? 120_000),
  };
}
