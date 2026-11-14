import { parseMarkdown, type DocumentHeading } from "@/lib/markdown-document";
import DOMPurify from "dompurify";
import { ArrowUp, Download, ListTree } from "lucide-react";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "./button";
import { CodeBlock } from "./code-block";
import { CopyButton } from "./copy-button";
import { MermaidBlock } from "./mermaid-block";
import { usePortalContainer } from "./platform/surface-context";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
export { MarkdownEditor } from "./markdown-editor";

export function MarkdownView({
  source,
  compact = false,
  preview = false,
  streaming = false,
  directoryContainer,
  navigation = true,
}: {
  source: string;
  compact?: boolean;
  preview?: boolean;
  streaming?: boolean;
  directoryContainer?: HTMLElement | null;
  navigation?: boolean;
}) {
  const portalContainer = usePortalContainer();
  const document = useMemo(() => parseMarkdown(source), [source]);
  const article = useRef<HTMLElement>(null);
  const root = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState("");
  const [backTop, setBackTop] = useState(false);
  const [open, setOpen] = useState(false);
  const [deep, setDeep] = useState(false);
  const toc = useRef<HTMLElement>(null);
  const directoryNavigation = useRef(false);
  const content = useMemo(() => {
    const html = DOMPurify.sanitize(document.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["img", "iframe", "object", "embed"],
      FORBID_ATTR: ["style"],
    });
    const dom = new DOMParser().parseFromString(html, "text/html");
    function render(node: Node, key: number): ReactNode {
      if (node.nodeType === 3) return node.textContent;
      if (!(node instanceof Element)) return null;
      const index = node.getAttribute("data-markdown-block");
      if (index !== null) {
        const block = document.blocks[Number(index)];
        if (!block) return null;
        return (
          <div
            key={key}
            data-source-line={node.getAttribute("data-source-line")}
          >
            {block.language === "mermaid" && !streaming ? (
              <MermaidBlock key={key} source={block.source} />
            ) : (
              <CodeBlock
                key={key}
                source={block.source}
                language={block.language}
                title={block.title}
                highlightedLines={block.highlightedLines}
              />
            )}
          </div>
        );
      }
      const attributes: Record<string, unknown> = {};
      const names: Record<string, string> = {
        class: "className",
        tabindex: "tabIndex",
        colspan: "colSpan",
        rowspan: "rowSpan",
      };
      for (const attr of [...node.attributes])
        if (!attr.name.startsWith("on"))
          attributes[names[attr.name] || attr.name] = attr.value;
      if (["br", "hr"].includes(node.tagName.toLowerCase()))
        return createElement(node.tagName.toLowerCase(), {
          ...attributes,
          key,
        });
      const children = [...node.childNodes]
        .filter(
          (child) =>
            !(
              ["TABLE", "THEAD", "TBODY", "TFOOT", "TR"].includes(
                node.tagName,
              ) &&
              child.nodeType === 3 &&
              !child.textContent?.trim()
            ),
        )
        .map(render);
      if (node.tagName === "TH" && !node.nextElementSibling) {
        const tableIndex = node
          .closest("table")
          ?.getAttribute("data-markdown-table");
        const tableSource =
          tableIndex != null ? document.tables[Number(tableIndex)] : undefined;
        if (tableSource !== undefined) {
          return (
            <th {...attributes} key={key}>
              <div className="markdown-table-heading">
                <span>{children}</span>
                <CopyButton value={tableSource} label="复制表格 Markdown" />
              </div>
            </th>
          );
        }
      }
      if (node.tagName === "TABLE") {
        return (
          <div key={key} className="markdown-table-frame">
            <div
              className="markdown-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Markdown 表格"
            >
              <table {...attributes}>{children}</table>
            </div>
          </div>
        );
      }
      return createElement(
        node.tagName.toLowerCase(),
        { ...attributes, key },
        ...children,
      );
    }
    return [...dom.body.childNodes].map(render);
  }, [document, streaming]);
  const scrollToHeading = useCallback(
    (id?: string) => {
      const target = id
        ? [
            ...(article.current?.querySelectorAll<HTMLElement>(
              "h1,h2,h3,h4,h5,h6",
            ) ?? []),
          ].find((el) => el.id === id)
        : article.current;
      if (!target) return;
      if (id) target.focus({ preventScroll: true });
      const scroll = root.current;
      const offset = scroll ? 24 : 88;
      const top =
        target.getBoundingClientRect().top -
        (scroll?.getBoundingClientRect().top ?? 0) +
        (scroll?.scrollTop ?? window.scrollY) -
        offset;
      if (scroll) scroll.scrollTo({ top: id ? top : 0, behavior: "smooth" });
      else window.scrollTo({ top: id ? top : 0, behavior: "smooth" });
      if (id) {
        setActive(id);
        if (!preview)
          window.history.replaceState(
            window.history.state,
            "",
            `${location.pathname}${location.search}#${encodeURIComponent(id)}`,
          );
      } else if (!preview)
        window.history.replaceState(
          window.history.state,
          "",
          `${location.pathname}${location.search}`,
        );
      setOpen(false);
    },
    [preview],
  );
  useEffect(() => {
    const element = article.current;
    if (!element) return;
    root.current = element.closest<HTMLElement>("[data-markdown-scroll]");
    if (!navigation) return;
    const scroll = root.current;
    const eventTarget = scroll ?? window;
    let frame = 0;
    const update = () => {
      const top = scroll ? scroll.getBoundingClientRect().top + 24 : 88;
      const headings = [
        ...element.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
      ];
      let current = headings[0]?.id ?? "";
      for (const heading of headings)
        if (heading.getBoundingClientRect().top <= top + 8)
          current = heading.id;
      setActive(current);
      setBackTop(
        top - element.getBoundingClientRect().top >
          (scroll?.clientHeight ?? window.innerHeight),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const fromHash = () => {
      if (preview || !location.hash) return;
      try {
        scrollToHeading(decodeURIComponent(location.hash.slice(1)));
      } catch {
        /* Ignore malformed fragments. */
      }
    };
    update();
    fromHash();
    eventTarget.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", fromHash);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : null;
    observer?.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      eventTarget.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", fromHash);
    };
  }, [document, preview, scrollToHeading, navigation]);
  useEffect(() => {
    const nav = toc.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !link) return;
    const delta =
      link.getBoundingClientRect().top - nav.getBoundingClientRect().top;
    if (delta < 0) nav.scrollTop += delta;
    else if (delta + link.offsetHeight > nav.clientHeight)
      nav.scrollTop += delta + link.offsetHeight - nav.clientHeight;
  }, [active]);
  const headings = document.headings.filter(
    (heading) => deep || heading.level <= 3,
  );
  const activeIndex = document.headings.findIndex(
    (heading) => heading.id === active,
  );
  const visibleActive = document.headings
    .slice(0, activeIndex + 1)
    .filter((heading) => deep || heading.level <= 3)
    .at(-1)?.id;
  function links(items: DocumentHeading[]) {
    return items.map((heading) => (
      <a
        key={heading.id}
        href={`#${heading.id}`}
        aria-current={visibleActive === heading.id ? "location" : undefined}
        style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}
        onClick={(event) => {
          event.preventDefault();
          directoryNavigation.current = open;
          scrollToHeading(heading.id);
        }}
      >
        {heading.title}
      </a>
    ));
  }
  const directory = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-border-subtle pb-3 text-sm text-muted">
        <span>目录</span>
        {document.headings.some((h) => h.level > 3) && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={deep}
            onClick={() => setDeep(!deep)}
          >
            {deep ? "收起层级" : "展开全部"}
          </Button>
        )}
      </div>
      {links(headings)}
    </>
  );
  const directoryButton = navigation && !!document.headings.length && (
    <div className={directoryContainer ? "flex" : "markdown-directory-trigger"}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant={directoryContainer ? "ghost" : "outline"}
              size="sm"
            >
              <ListTree />
              目录
            </Button>
          }
        />
        <PopoverContent
          align="end"
          className="w-72"
          finalFocus={() => {
            if (directoryNavigation.current) {
              directoryNavigation.current = false;
              return false;
            }
            return true;
          }}
        >
          <nav
            className="markdown-directory max-h-[60vh] overflow-auto"
            aria-label="文档目录"
          >
            {directory}
          </nav>
        </PopoverContent>
      </Popover>
    </div>
  );
  return (
    <div
      className={`markdown-layout ${compact ? "markdown-layout-compact" : ""} ${navigation && document.headings.length ? "has-directory" : ""}`}
    >
      {directoryContainer
        ? createPortal(directoryButton, directoryContainer)
        : directoryButton}
      <div className="markdown-reading-grid">
        <article
          ref={article}
          className="markdown"
          aria-label="Markdown 正文"
          onClick={(event) => {
            const link = (event.target as Element).closest?.("a");
            const href = link?.getAttribute("href");
            if (
              href?.startsWith("#") &&
              document.headings.some((h) => `#${h.id}` === href)
            ) {
              event.preventDefault();
              scrollToHeading(href.slice(1));
            }
          }}
        >
          {source.trim() ? (
            content
          ) : (
            <p className="text-sm text-muted">暂无介绍内容。</p>
          )}
        </article>
        {navigation && !!document.headings.length && !compact && (
          <aside className="markdown-directory-rail">
            <nav ref={toc} className="markdown-directory" aria-label="文档目录">
              {directory}
            </nav>
          </aside>
        )}
      </div>
      {navigation &&
        backTop &&
        (preview && root.current?.parentElement
          ? createPortal(
              <div className="markdown-back-top is-preview">
                <IconButton label="回到顶部" onClick={() => scrollToHeading()}>
                  <ArrowUp />
                </IconButton>
              </div>,
              root.current.parentElement,
            )
          : createPortal(
              <div className="markdown-back-top">
                <IconButton label="回到顶部" onClick={() => scrollToHeading()}>
                  <ArrowUp />
                </IconButton>
              </div>,
              portalContainer ?? window.document.body,
            ))}
    </div>
  );
}
export function MarkdownActions({ source }: { source: string }) {
  return <CopyButton value={source} label="复制 Markdown" text />;
}
export function DownloadLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <a
      className="button inline-flex items-center gap-2 text-link"
      href={href}
      download
    >
      <Download className="size-4" />
      {children}
    </a>
  );
}
