import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useAppStore,
  type ChangeView,
  type ChatItem,
  type ChatMode,
  type PermissionKind,
  type PermissionMode,
  type ProviderView,
} from "./store";
import { vscode } from "./vscode";
import { tokenizeCode } from "./codeHighlighter";

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
  const providers = useAppStore((state) => state.providers);
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
            <span className="model-status" data-ready={providers.some((item) => item.hasApiKey)} />
            {providers.length > 1 ? `${providers.length} 个模型` : provider?.modelId || "配置模型"}
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
  const contexts = useAppStore((state) => state.contexts);
  const providers = useAppStore((state) => state.providers);
  const providerAssignments = useAppStore((state) => state.providerAssignments);
  const permissions = useAppStore((state) => state.permissions);
  const selectedProvider =
    providers.find((provider) => provider.id === providerAssignments[mode]) ?? providers[0];
  const agentProvider =
    providers.find((provider) => provider.id === providerAssignments.agent) ?? providers[0];
  const latestAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && !message.pending)?.id;
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
    if (!value || activeRequestId || !activeSession || activeSession.archivedAt) {
      return;
    }
    vscode.postMessage({
      type: "chat/send",
      requestId: crypto.randomUUID(),
      sessionId: activeSession.id,
      text: value,
      mode,
      ...(selectedProvider ? { providerId: selectedProvider.id } : {}),
      includeActiveEditor,
      includeWorkspace,
      contextIds: contexts.map((context) => context.id),
    });
    setText("");
  };

  const reuse = (message: ChatItem): void => {
    setText(message.text);
    if (message.mode) {
      setMode(message.mode);
    }
  };

  const executePlan = (message: ChatItem): void => {
    if (
      !activeSession ||
      activeSession.archivedAt ||
      activeRequestId ||
      message.mode !== "plan" ||
      message.error
    ) {
      return;
    }
    vscode.postMessage({
      type: "chat/confirm-plan",
      requestId: crypto.randomUUID(),
      sessionId: activeSession.id,
      planMessageId: message.id,
      ...(agentProvider ? { providerId: agentProvider.id } : {}),
    });
    setMode("agent");
  };

  const regenerate = (message: ChatItem): void => {
    if (
      !activeSession ||
      activeSession.archivedAt ||
      activeRequestId ||
      message.role !== "assistant"
    ) {
      return;
    }
    const retryMode = message.mode ?? "ask";
    const retryProvider =
      providers.find((provider) => provider.id === providerAssignments[retryMode]) ?? providers[0];
    vscode.postMessage({
      type: "chat/regenerate",
      requestId: crypto.randomUUID(),
      sessionId: activeSession.id,
      assistantMessageId: message.id,
      ...(retryProvider ? { providerId: retryProvider.id } : {}),
      includeActiveEditor,
      includeWorkspace,
    });
    setMode(retryMode);
  };

  const regenerationDisabledReason = (message: ChatItem): string | undefined => {
    const retryMode = message.mode ?? "ask";
    const retryProvider =
      providers.find((provider) => provider.id === providerAssignments[retryMode]) ?? providers[0];
    return activeRequestId
      ? "当前已有任务正在执行"
      : activeSession?.archivedAt
        ? "请先恢复该归档对话"
        : !workspaceTrusted
          ? "当前工作区未受信任"
          : !retryProvider?.hasApiKey
            ? "请先为该模式配置可用模型和 API Key"
            : undefined;
  };

  const planExecutionDisabledReason = activeRequestId
    ? "当前已有任务正在执行"
    : activeSession?.archivedAt
      ? "请先恢复该归档对话"
      : !workspaceTrusted
        ? "当前工作区未受信任"
        : !agentProvider?.hasApiKey
          ? "请先为执行模式配置可用模型和 API Key"
          : undefined;

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
      {activeSession?.archivedAt && (
        <div className="warning-card">该对话已归档，当前为只读状态。点击“恢复”后可继续协作。</div>
      )}

      <div className="messages" aria-live="polite">
        {messages.length === 0 && (
          <EmptyChat
            applyTemplate={applyTemplate}
            providerReady={Boolean(selectedProvider?.hasApiKey)}
            providerTested={Boolean(selectedProvider?.lastTestedAt)}
            workspaceTrusted={workspaceTrusted}
          />
        )}
        {messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            onReuse={() => reuse(message)}
            onExecutePlan={() => executePlan(message)}
            executePlanDisabledReason={planExecutionDisabledReason}
            onRegenerate={() => regenerate(message)}
            showRegenerate={message.id === latestAssistantId}
            regenerateDisabledReason={regenerationDisabledReason(message)}
          />
        ))}
        <div ref={endRef} />
      </div>

      <ExecutionTimeline />

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
          <label className="model-quick-select" title="切换当前模式使用的模型">
            <span>模型</span>
            <select
              value={selectedProvider?.id ?? ""}
              onChange={(event) =>
                vscode.postMessage({
                  type: "provider/assign",
                  mode,
                  providerId: event.target.value,
                })
              }
              disabled={providers.length === 0}
              aria-label="当前模型"
            >
              {providers.length === 0 ? <option value="">尚未配置</option> : null}
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName} · {provider.modelId}
                  {provider.hasApiKey ? "" : "（缺少密钥）"}
                </option>
              ))}
            </select>
          </label>
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
          {contexts.map((context) => (
            <button
              key={context.id}
              type="button"
              className="chip active"
              onClick={() => vscode.postMessage({ type: "context/remove", contextId: context.id })}
              title={`${context.characters} 字符${context.truncated ? "，已截断" : ""}`}
            >
              {context.kind === "directory"
                ? "目录"
                : context.kind === "git-diff"
                  ? "Git Diff"
                  : "终端"}
              ：{context.label} ×
            </button>
          ))}
          <button
            type="button"
            className={
              Object.values(permissions).includes("deny") ? "chip permission-denied" : "chip"
            }
            onClick={() => vscode.postMessage({ type: "ui/open-settings" })}
            title="打开读取、网络、修改和命令权限设置"
          >
            {permissions.network === "deny"
              ? "离线模式"
              : Object.values(permissions).includes("deny")
                ? "部分权限已关闭"
                : "权限已设置"}
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
              disabled={
                !text.trim() ||
                !workspaceTrusted ||
                !activeSession ||
                Boolean(activeSession.archivedAt) ||
                !selectedProvider?.hasApiKey
              }
              title={selectedProvider?.hasApiKey ? "发送消息" : "请先为当前模型配置 API Key"}
            >
              发送
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function ExecutionTimeline(): React.JSX.Element | null {
  const status = useAppStore((state) => state.requestStatus);
  const steps = useAppStore((state) => state.executionSteps);
  const running = useAppStore((state) => Boolean(state.activeRequestId) || state.testRunning);
  const [expanded, setExpanded] = useState(true);

  if (!status && steps.length === 0) {
    return null;
  }

  return (
    <section className="execution-timeline" aria-live="polite">
      <button
        type="button"
        className="execution-summary"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className={`execution-indicator ${running ? "running" : "completed"}`} />
        <strong>{status ?? "任务执行过程"}</strong>
        <span>{steps.length > 0 ? `${steps.length} 个工具步骤` : ""}</span>
        <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
      </button>
      {expanded && steps.length > 0 && (
        <ol className="execution-steps">
          {steps.map((step) => (
            <li key={step.id} className={step.status}>
              <span className="step-icon" aria-hidden="true">
                {step.status === "running" ? "●" : step.status === "completed" ? "✓" : "!"}
              </span>
              <div>
                <strong>{step.label}</strong>
                {step.input && <code>{step.input}</code>}
                <span>
                  {step.summary || "正在执行…"}
                  {step.durationMs !== undefined ? ` · ${step.durationMs} ms` : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SessionToolbar(): React.JSX.Element {
  const sessions = useAppStore((state) => state.sessions);
  const activeSession = useAppStore((state) => state.activeSession);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const archived = activeSession?.archivedAt !== undefined;

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

  const toggleArchive = (): void => {
    if (!activeSession) {
      return;
    }
    if (archived) {
      vscode.postMessage({ type: "session/restore", sessionId: activeSession.id });
      return;
    }
    if (window.confirm(`确认归档对话“${activeSession.title}”？归档后仍可恢复。`)) {
      vscode.postMessage({ type: "session/archive", sessionId: activeSession.id });
    }
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
            {session.archived ? "[已归档] " : ""}
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
      <button
        type="button"
        className="icon-button"
        title="重命名"
        onClick={rename}
        disabled={!activeSession || Boolean(activeRequestId)}
      >
        ✎
      </button>
      <button
        type="button"
        title={archived ? "恢复对话" : "归档对话"}
        onClick={toggleArchive}
        disabled={!activeSession || Boolean(activeRequestId)}
      >
        {archived ? "恢复" : "归档"}
      </button>
      <button
        type="button"
        className="icon-button danger"
        title="删除对话"
        onClick={remove}
        disabled={!activeSession || Boolean(activeRequestId)}
      >
        ×
      </button>
    </div>
  );
}

function EmptyChat({
  applyTemplate,
  providerReady,
  providerTested,
  workspaceTrusted,
}: {
  readonly applyTemplate: (template: string, mode: ChatMode, workspace?: boolean) => void;
  readonly providerReady: boolean;
  readonly providerTested: boolean;
  readonly workspaceTrusted: boolean;
}): React.JSX.Element {
  if (!providerReady || !providerTested || !workspaceTrusted) {
    return (
      <div className="empty-state onboarding">
        <div className="empty-icon" aria-hidden="true">
          1·2·3
        </div>
        <h2>完成首次使用设置</h2>
        <p>按照下面三步连接自备模型。配置和诊断信息均保留在本机 VS Code 中。</p>
        <ol className="onboarding-steps">
          <li className={workspaceTrusted ? "completed" : ""}>
            <strong>信任工作区</strong>
            <span>{workspaceTrusted ? "已完成" : "请先确认当前项目可信"}</span>
          </li>
          <li className={providerReady ? "completed" : ""}>
            <strong>配置模型与 API Key</strong>
            <span>{providerReady ? "已安全配置" : "支持 OpenAI Compatible、内网或本地服务"}</span>
          </li>
          <li className={providerTested ? "completed" : ""}>
            <strong>测试连接</strong>
            <span>{providerTested ? "连接测试已通过" : "保存后在设置页点击“测试连接”"}</span>
          </li>
        </ol>
        <button
          type="button"
          className="primary"
          onClick={() =>
            vscode.postMessage({
              type: workspaceTrusted ? "ui/open-settings" : "ui/manage-trust",
            })
          }
        >
          {!workspaceTrusted
            ? "管理工作区信任"
            : providerReady
              ? "打开设置并测试连接"
              : "打开模型与安全设置"}
        </button>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        ✦
      </div>
      <h2>从一个真实开发任务开始</h2>
      <p>选择上下文和工作模式，AI 会在修改前让你审核。</p>
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
  onExecutePlan,
  executePlanDisabledReason,
  onRegenerate,
  showRegenerate,
  regenerateDisabledReason,
}: {
  readonly message: ChatItem;
  readonly onReuse: () => void;
  readonly onExecutePlan: () => void;
  readonly executePlanDisabledReason?: string | undefined;
  readonly onRegenerate: () => void;
  readonly showRegenerate: boolean;
  readonly regenerateDisabledReason?: string | undefined;
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
          {message.mode && (
            <small>{modes.find((item) => item.value === message.mode)?.label}</small>
          )}
        </div>
        <div className="message-actions">
          {message.role === "user" && (
            <button type="button" onClick={onReuse}>
              再次使用
            </button>
          )}
          {message.role === "assistant" && showRegenerate && !message.pending && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={Boolean(regenerateDisabledReason)}
              title={regenerateDisabledReason ?? "使用当前上下文重新生成最近一条回复"}
            >
              重新生成
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => <>{children}</>,
              code: ({ children, className }) => {
                const raw = markdownCodeText(children);
                const block = Boolean(className?.startsWith("language-") || raw.includes("\n"));
                if (!block) {
                  return <code className={className}>{children}</code>;
                }
                const language = className?.replace(/^language-/, "") ?? "";
                return (
                  <CodeBlock
                    code={raw.replace(/\n$/, "")}
                    language={language}
                    allowPropose={message.role === "assistant"}
                  />
                );
              },
            }}
          >
            {message.text}
          </ReactMarkdown>
        </div>
      )}
      {message.role === "assistant" &&
        message.mode === "plan" &&
        !message.pending &&
        !message.error &&
        Boolean(message.text) && (
          <div className="message-followup-actions">
            <button
              type="button"
              className="primary"
              onClick={onExecutePlan}
              disabled={Boolean(executePlanDisabledReason)}
              title={executePlanDisabledReason ?? "确认该计划，并切换到执行模式"}
            >
              确认并执行计划
            </button>
            <span>执行产生的文件修改仍需在变更中心审核。</span>
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

function markdownCodeText(value: React.ReactNode): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(markdownCodeText).join("");
  }
  return "";
}

function CodeBlock({
  code,
  language,
  allowPropose,
}: {
  readonly code: string;
  readonly language: string;
  readonly allowPropose: boolean;
}): React.JSX.Element {
  const workspaceTrusted = useAppStore((state) => state.workspaceTrusted);
  const tokens = useMemo(() => tokenizeCode(code), [code]);
  const copy = (): void => {
    void navigator.clipboard.writeText(code);
  };
  const propose = (): void => {
    vscode.postMessage({
      type: "code/propose-insert",
      code,
      ...(language ? { language } : {}),
    });
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language || "代码"}</span>
        <div>
          <button type="button" onClick={copy}>
            复制
          </button>
          {allowPropose && (
            <button
              type="button"
              onClick={propose}
              disabled={!workspaceTrusted || !code}
              title={
                workspaceTrusted
                  ? "替换当前选区或在光标处插入，并送到变更中心审核"
                  : "当前工作区未受信任"
              }
            >
              送入变更中心
            </button>
          )}
        </div>
      </div>
      <pre>
        <code>
          {tokens.map((token, index) => (
            <span className={`code-token ${token.kind}`} key={`${index}-${token.value.length}`}>
              {token.value}
            </span>
          ))}
        </code>
      </pre>
    </div>
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
        <strong>添加任务上下文</strong>
        <span>内容仅在本次发送时使用；敏感路径和常见凭据会被过滤。</span>
      </div>
      <div className="context-actions">
        <button
          type="button"
          onClick={() => vscode.postMessage({ type: "context/add", kind: "directory" })}
        >
          ＋ 目录结构
        </button>
        <button
          type="button"
          onClick={() => vscode.postMessage({ type: "context/add", kind: "git-diff" })}
        >
          ＋ Git Diff
        </button>
        <button
          type="button"
          onClick={() => vscode.postMessage({ type: "context/add", kind: "terminal" })}
          title="先在终端复制输出，再点击此按钮"
        >
          ＋ 终端输出
        </button>
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
              setText((value) => `${value}${value.trim() ? "\n" : ""}@file(${result.relativePath})`)
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
          onClick={() => vscode.postMessage({ type: "project/analyze", force: Boolean(overview) })}
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
            <Metric label="运行依赖" value={String(overview.dependencyCount)} />
            <Metric label="开发依赖" value={String(overview.devDependencyCount)} />
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
          <OverviewSection title="依赖摘要">
            <TagList values={overview.dependencies} empty="未识别到包依赖" />
          </OverviewSection>
          <OverviewSection title="Git 状态">
            {overview.gitStatus.available ? (
              <div className="metric-grid two">
                <Metric label="当前分支" value={overview.gitStatus.branch} />
                <Metric label="变更文件" value={String(overview.gitStatus.changedFiles)} />
                <Metric label="已暂存" value={String(overview.gitStatus.stagedFiles)} />
                <Metric label="未跟踪" value={String(overview.gitStatus.untrackedFiles)} />
                <Metric label="冲突" value={String(overview.gitStatus.conflictedFiles)} />
              </div>
            ) : (
              <p className="muted">当前工作区未检测到可用 Git 仓库。</p>
            )}
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
          <OverviewSection title="潜在风险">
            {overview.risks.length === 0 ? (
              <p className="muted">本次静态画像未发现明显结构风险。</p>
            ) : (
              overview.risks.map((risk) => (
                <div className="warning-card" key={risk}>
                  {risk}
                </div>
              ))
            )}
          </OverviewSection>
          <OverviewSection title="建议阅读顺序">
            {overview.readingSuggestions.length === 0 ? (
              <p className="muted">暂未生成阅读建议。</p>
            ) : (
              <ol className="reading-list">
                {overview.readingSuggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ol>
            )}
          </OverviewSection>
          <p className="analyzed-at">
            索引状态：{overview.index.status === "ready" ? "完整" : "部分"}
            {overview.index.cached ? " · 已复用缓存" : " · 本次重新扫描"}
            {" · "}
            分析时间：{new Date(overview.analyzedAt).toLocaleString("zh-CN")}
          </p>
        </>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
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
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const activeSession = useAppStore((state) => state.activeSession);
  const providers = useAppStore((state) => state.providers);
  const providerAssignments = useAppStore((state) => state.providerAssignments);
  const workspaceTrusted = useAppStore((state) => state.workspaceTrusted);
  const agentProvider =
    providers.find((provider) => provider.id === providerAssignments.agent) ?? providers[0];
  const visibleChanges = useMemo(
    () => changes.filter((change) => change.status !== "rejected"),
    [changes],
  );
  const pendingCount = visibleChanges.filter((change) => change.status === "pending").length;
  const appliedCount = visibleChanges.filter((change) => change.status === "applied").length;
  const addedLines = visibleChanges.reduce((total, change) => total + change.addedLines, 0);
  const deletedLines = visibleChanges.reduce((total, change) => total + change.deletedLines, 0);
  const validateApplied = (): void => {
    if (!activeSession || activeRequestId || appliedCount === 0) {
      return;
    }
    vscode.postMessage({
      type: "chat/validate-applied",
      requestId: crypto.randomUUID(),
      sessionId: activeSession.id,
      ...(agentProvider ? { providerId: agentProvider.id } : {}),
    });
  };

  return (
    <section className="content-view">
      <div className="section-heading">
        <div>
          <h2>变更审核</h2>
          <p>AI 生成的修改只有经过 Diff 审核和明确批准后才会写入工作区。</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: "test/run" })}
            disabled={testRunning}
          >
            {testRunning ? "测试运行中…" : "运行测试"}
          </button>
          <button
            type="button"
            className="primary"
            onClick={validateApplied}
            disabled={
              appliedCount === 0 ||
              Boolean(activeRequestId) ||
              !activeSession ||
              Boolean(activeSession.archivedAt) ||
              !workspaceTrusted ||
              !agentProvider?.hasApiKey
            }
            title={
              appliedCount === 0
                ? "请先审核并应用一组修改"
                : activeSession?.archivedAt
                  ? "请先恢复当前归档对话"
                  : agentProvider?.hasApiKey
                    ? "启动执行回合并逐次审批测试命令"
                    : "请先为执行模式配置模型和 API Key"
            }
          >
            Agent 验证变更
          </button>
        </div>
      </div>

      <ExecutionTimeline />

      <div className="metric-grid">
        <Metric label="待审核" value={String(pendingCount)} />
        <Metric label="已应用" value={String(appliedCount)} />
        <Metric label="新增行" value={`+${addedLines}`} />
        <Metric label="删除行" value={`-${deletedLines}`} />
      </div>

      {(pendingCount > 0 || appliedCount > 0) && (
        <div className="change-toolbar">
          {pendingCount > 0 && (
            <>
              <button
                type="button"
                className="primary"
                onClick={() => vscode.postMessage({ type: "change/apply-all" })}
              >
                全部审核并应用
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => vscode.postMessage({ type: "change/reject-all" })}
              >
                全部拒绝
              </button>
            </>
          )}
          {appliedCount > 0 && (
            <button
              type="button"
              onClick={() => vscode.postMessage({ type: "change/rollback-latest" })}
            >
              回滚最近检查点
            </button>
          )}
        </div>
      )}

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
    "rollback-conflicted": "回滚冲突",
    "rolled-back": "已回滚",
  };
  return (
    <article className="change-card">
      <div className="change-heading">
        <div>
          <strong>{change.path}</strong>
          <span>
            {change.operation === "create" ? "新建文件" : "更新文件"} ·{" "}
            <span className="line-added">+{change.addedLines}</span>{" "}
            <span className="line-deleted">-{change.deletedLines}</span>
          </span>
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
        {change.status === "applied" && (
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: "change/rollback", changeId: change.id })}
          >
            回滚此文件
          </button>
        )}
      </div>
    </article>
  );
}

function ModelsView(): React.JSX.Element {
  const providers = useAppStore((state) => state.providers);
  const assignments = useAppStore((state) => state.providerAssignments);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [selectedId, setSelectedId] = useState<string>();
  const provider = selectedId ? providers.find((item) => item.id === selectedId) : providers[0];
  const providerId = provider?.id ?? selectedId ?? draftId;

  const createProvider = (): void => {
    const id = crypto.randomUUID();
    setDraftId(id);
    setSelectedId(id);
  };

  const deleteProvider = (id: string): void => {
    if (!window.confirm("确认删除这个模型配置及其独立 API Key？此操作无法撤销。")) {
      return;
    }
    setSelectedId(providers.find((item) => item.id !== id)?.id);
    vscode.postMessage({ type: "provider/delete", providerId: id });
  };

  return (
    <section className="content-view settings-view">
      <div className="section-heading">
        <div>
          <h1>模型与安全设置</h1>
          <p>管理多个 OpenAI Compatible 模型，密钥分别保存到 VS Code SecretStorage</p>
        </div>
        <button type="button" className="primary" onClick={createProvider}>
          ＋ 新增
        </button>
      </div>

      <div className="model-settings-layout">
        <nav className="provider-list" aria-label="模型配置列表">
          {providers.length === 0 && selectedId === undefined ? <p>尚未保存模型配置</p> : null}
          {providers.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === providerId ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <span>
                <strong>{item.displayName}</strong>
                <small>{item.modelId}</small>
              </span>
              <i className="model-status" data-ready={item.hasApiKey} />
            </button>
          ))}
          {!provider && selectedId ? (
            <button type="button" className="active">
              <span>
                <strong>新模型</strong>
                <small>尚未保存</small>
              </span>
            </button>
          ) : null}
        </nav>

        <div className="provider-editor">
          <ModeAssignments providers={providers} assignments={assignments} />
          <ModelsForm
            key={`${providerId}-${provider?.updatedAt ?? "new"}`}
            providerId={providerId}
            provider={provider}
            onDelete={deleteProvider}
          />
        </div>
      </div>
      <PermissionSettings />
      <DiagnosticsSettings />
    </section>
  );
}

function ModelsForm({
  providerId,
  provider,
  onDelete,
}: {
  readonly providerId: string;
  readonly provider: ProviderView | undefined;
  readonly onDelete: (providerId: string) => void;
}): React.JSX.Element {
  const [form, setForm] = useState(() => providerToForm(provider));
  const [apiKey, setApiKey] = useState("");

  const save = (event: FormEvent): void => {
    event.preventDefault();
    vscode.postMessage({
      type: "provider/save",
      providerId,
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
    <>
      <div className="section-heading">
        <div>
          <h2>{provider ? "编辑模型" : "新增模型"}</h2>
          <p>OpenAI Compatible · 每个模型使用独立密钥</p>
        </div>
        <span className={`connection-badge ${provider?.lastTestedAt ? "ready" : ""}`}>
          {!provider?.hasApiKey ? "未配置" : provider.lastTestedAt ? "已连接" : "待测试"}
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
          <span>
            {provider?.lastTestedAt
              ? `连接测试已通过：${new Date(provider.lastTestedAt).toLocaleString()}`
              : "保存或更新配置后，请执行一次连接测试。"}
          </span>
        </div>
        <div className="actions">
          <button type="submit" className="primary">
            保存配置
          </button>
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: "provider/test", providerId })}
            disabled={!provider?.hasApiKey}
          >
            测试连接
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => vscode.postMessage({ type: "provider/clear-key", providerId })}
            disabled={!provider?.hasApiKey}
          >
            移除密钥
          </button>
          {provider ? (
            <button type="button" className="danger" onClick={() => onDelete(providerId)}>
              删除配置
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}

function ModeAssignments({
  providers,
  assignments,
}: {
  readonly providers: readonly ProviderView[];
  readonly assignments: Partial<Record<ChatMode, string>>;
}): React.JSX.Element {
  const fallback = providers[0]?.id ?? "";
  return (
    <section className="mode-assignments">
      <div>
        <h2>默认模型分配</h2>
        <p>聊天输入区仍可随时切换，并同步更新当前模式的默认模型。</p>
      </div>
      <div className="assignment-grid">
        {modes.map((mode) => (
          <label key={mode.value}>
            <span>{mode.label}</span>
            <select
              value={assignments[mode.value] ?? fallback}
              onChange={(event) =>
                vscode.postMessage({
                  type: "provider/assign",
                  mode: mode.value,
                  providerId: event.target.value,
                })
              }
              disabled={providers.length === 0}
            >
              {providers.length === 0 ? <option value="">尚未配置</option> : null}
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName} · {provider.modelId}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

const permissionDefinitions: readonly {
  kind: PermissionKind;
  label: string;
  description: string;
}[] = [
  {
    kind: "read",
    label: "工作区读取",
    description: "读取文件、搜索代码、生成项目概览和 Agent 只读工具。",
  },
  {
    kind: "network",
    label: "模型网络访问",
    description: "连接用户配置的模型服务；关闭后进入离线模式。",
  },
  {
    kind: "modify",
    label: "文件修改",
    description: "应用或回滚变更；即使允许，仍必须审核 Diff 并二次确认。",
  },
  {
    kind: "command",
    label: "命令执行",
    description: "运行检测到的测试或诊断命令；仍会显示命令并二次确认。",
  },
];

const permissionModeLabels: Readonly<Record<PermissionMode, string>> = {
  allow: "允许",
  ask: "每次询问",
  deny: "关闭",
};

function PermissionSettings(): React.JSX.Element {
  const permissions = useAppStore((state) => state.permissions);
  return (
    <section className="permission-settings">
      <div>
        <h2>权限与离线模式</h2>
        <p>四类能力独立控制。工作区信任、敏感路径、Diff 审核和命令确认仍会继续生效。</p>
      </div>
      <div className="permission-grid">
        {permissionDefinitions.map((permission) => (
          <label key={permission.kind}>
            <span>
              <strong>{permission.label}</strong>
              <small>{permission.description}</small>
            </span>
            <select
              value={permissions[permission.kind]}
              onChange={(event) =>
                vscode.postMessage({
                  type: "permission/update",
                  kind: permission.kind,
                  mode: event.target.value as PermissionMode,
                })
              }
              aria-label={`${permission.label}权限`}
            >
              {(Object.keys(permissionModeLabels) as PermissionMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {permissionModeLabels[mode]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

function DiagnosticsSettings(): React.JSX.Element {
  return (
    <section className="permission-settings diagnostics-settings">
      <div>
        <h2>日志与诊断</h2>
        <p>复制用于排查安装、模型状态、权限、会话和变更恢复问题的本地脱敏摘要。</p>
      </div>
      <div className="security-note">
        <strong>不会包含 API Key、Base URL、工作区路径或代码内容</strong>
        <span>复制后请先自行检查，再发送给技术支持。</span>
      </div>
      <button type="button" onClick={() => vscode.postMessage({ type: "diagnostics/copy" })}>
        复制脱敏诊断信息
      </button>
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
