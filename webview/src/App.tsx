import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAppStore, type ChatMode, type ProviderView } from "./store";
import { vscode } from "./vscode";

const modes: readonly { value: ChatMode; label: string }[] = [
  { value: "ask", label: "问答" },
  { value: "explain", label: "解释" },
  { value: "edit", label: "编辑" },
  { value: "agent", label: "智能体" },
  { value: "review", label: "审查" },
  { value: "test", label: "测试" },
  { value: "document", label: "文档" },
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
      {viewKind === "models" ? <ModelsView /> : <ChatView />}
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
      {notice.message}
    </button>
  );
}

function ChatView(): React.JSX.Element {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>("ask");
  const [includeActiveEditor, setIncludeActiveEditor] = useState(true);
  const [search, setSearch] = useState("");
  const messages = useAppStore((state) => state.messages);
  const changes = useAppStore((state) => state.changes);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const searchResults = useAppStore((state) => state.searchResults);
  const testResult = useAppStore((state) => state.testResult);
  const prefill = useAppStore((state) => state.prefill);
  const consumePrefill = useAppStore((state) => state.consumePrefill);
  const workspaceTrusted = useAppStore((state) => state.workspaceTrusted);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefill) {
      // The prefill is an Extension Host event, so synchronizing it into the
      // editable local draft is an intentional external-system update.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(prefill.text);
      setMode(prefill.mode);
      consumePrefill();
    }
  }, [consumePrefill, prefill]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const pendingChanges = useMemo(
    () =>
      changes.filter(
        (change) =>
          change.status === "pending" ||
          change.status === "approved" ||
          change.status === "conflicted" ||
          change.status === "failed",
      ),
    [changes],
  );

  const send = (event: FormEvent): void => {
    event.preventDefault();
    const value = text.trim();
    if (!value || activeRequestId) {
      return;
    }
    vscode.postMessage({
      type: "chat/send",
      requestId: crypto.randomUUID(),
      text: value,
      mode,
      includeActiveEditor,
    });
    setText("");
  };

  return (
    <>
      <header className="header">
        <div>
          <h1>AI 编程</h1>
          <p>{workspaceTrusted ? "工作区已受信任" : "受限模式：请先信任工作区"}</p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => vscode.postMessage({ type: "test/run" })}
        >
          运行测试
        </button>
      </header>

      <section className="messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="empty">
            <strong>开始一个任务</strong>
            <span>可使用 @workspace、@file(path) 或 @search(text) 添加上下文。</span>
          </div>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`message ${message.role} ${message.error ? "error" : ""}`}
          >
            <small>{message.role === "user" ? "你" : "AI"}</small>
            <pre>{message.text || (message.pending ? "正在生成…" : "")}</pre>
          </article>
        ))}
        <div ref={endRef} />
      </section>

      {pendingChanges.length > 0 && (
        <section className="panel">
          <h2>待审核修改</h2>
          {pendingChanges.map((change) => (
            <article key={change.id} className="change-card">
              <strong>{change.path}</strong>
              <span>
                {change.operation} · {change.status}
              </span>
              {change.reason && <p>{change.reason}</p>}
              {change.error && <p className="error-text">{change.error}</p>}
              <div className="actions">
                <button
                  type="button"
                  onClick={() =>
                    vscode.postMessage({
                      type: "change/preview",
                      changeId: change.id,
                    })
                  }
                >
                  查看 Diff
                </button>
                {change.status === "pending" && (
                  <>
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        vscode.postMessage({
                          type: "change/apply",
                          changeId: change.id,
                        })
                      }
                    >
                      审核并应用
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        vscode.postMessage({
                          type: "change/reject",
                          changeId: change.id,
                        })
                      }
                    >
                      拒绝
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="panel compact">
        <h2>工作区搜索</h2>
        <div className="inline">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="输入至少 2 个字符"
          />
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: "workspace/search", query: search })}
            disabled={search.trim().length < 2}
          >
            搜索
          </button>
        </div>
        {searchResults.slice(0, 20).map((result) => (
          <div key={`${result.uri}:${result.line}`} className="search-result">
            <strong>
              {result.relativePath}:{result.line + 1}
            </strong>
            <span>{result.preview}</span>
          </div>
        ))}
      </section>

      {testResult && (
        <section className="panel">
          <h2>最近测试结果</h2>
          <p>
            {testResult.command} · 退出码 {testResult.exitCode ?? "未知"} · {testResult.durationMs}{" "}
            ms
          </p>
          <pre className="test-output">{testResult.output.slice(-8000)}</pre>
        </section>
      )}

      <form className="composer" onSubmit={send}>
        <div className="composer-toolbar">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as ChatMode)}
            aria-label="对话模式"
          >
            {modes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={includeActiveEditor}
              onChange={(event) => setIncludeActiveEditor(event.target.checked)}
            />
            当前文件/选区
          </label>
        </div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="描述问题或任务…"
          rows={5}
        />
        <div className="actions right">
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
              停止
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!text.trim() || !workspaceTrusted}>
              发送
            </button>
          )}
        </div>
      </form>
    </>
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
    <>
      <header className="header">
        <div>
          <h1>模型配置</h1>
          <p>OpenAI Compatible · 密钥仅保存到 VS Code SecretStorage</p>
        </div>
      </header>
      <form className="settings" onSubmit={save}>
        <label>
          配置名称
          <input
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            required
          />
        </label>
        <label>
          Base URL
          <input
            value={form.baseUrl}
            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            placeholder="https://example.com/v1"
            required
          />
        </label>
        <label>
          Model ID
          <input
            value={form.modelId}
            onChange={(event) => setForm({ ...form, modelId: event.target.value })}
            required
          />
        </label>
        <label>
          请求超时（毫秒）
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
          API Key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider?.hasApiKey ? "已配置；留空表示不修改" : "请输入 API Key"}
            autoComplete="off"
          />
        </label>
        <p className="secret-state">密钥状态：{provider?.hasApiKey ? "已安全配置" : "未配置"}</p>
        <div className="actions">
          <button type="submit" className="primary">
            保存
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
    </>
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
    timeoutMs: String(provider?.timeoutMs ?? 120000),
  };
}
