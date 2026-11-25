import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";

/** Markdown with links opened in the system browser instead of inside the launcher. */
export function Md({ children }: { children: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) api.openUrl(href).catch(() => {});
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
