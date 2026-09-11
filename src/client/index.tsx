/** dsh-workspace-scope — Client entry and slot registration. */
import { createElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { ScopeBar } from "./components.js";
import type { DockProps } from "./model.js";
import { ScopeModalSeat } from "./scope-modal.js";

declare const __WSC_CSS__: string;

export const name = "workspace-scope-client";
export const inject = ["slots"];

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "workspace-scope";
    tag.textContent = __WSC_CSS__;
    document.head.appendChild(tag);
    return () => tag.remove();
  });

  const slots = ctx.get("slots") as
    | {
        inject(key: string, callback: () => unknown): unknown;
        register(options: Record<string, unknown>, component: unknown): unknown;
      }
    | undefined;
  if (slots === undefined) return;

  slots.inject("conversation.input.right", () =>
    slots.register(
      {
        name: "conversation.input.right",
        id: "workspace-scope",
        order: 30,
        label: () => "工作区能力",
      },
      (props: unknown) => createElement(ScopeBar, props as DockProps),
    ),
  );

  slots.inject("shell.overlay", () =>
    slots.register(
      { name: "shell.overlay", id: "workspace-scope-modal", order: 50 },
      (props: unknown) => createElement(ScopeModalSeat, props as DockProps),
    ),
  );
}
