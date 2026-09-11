/** dsh-workspace-scope — Client entry and slot registration. */
import React from "react";
import type { Context } from "@deepseek-ai/cordis";
import { ScopeBar } from "./components";
import type { DockProps } from "./model";
import { ScopeModal } from "./scope-modal";
import { CSS } from "./styles";

export const name = "workspace-scope-client";
export const inject = ["slots"];

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "workspace-scope";
    tag.textContent = CSS;
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
      (props: unknown) => React.createElement(ScopeBar, props as DockProps),
    ),
  );

  slots.inject("shell.overlay", () =>
    slots.register(
      { name: "shell.overlay", id: "workspace-scope-modal", order: 50 },
      (props: unknown) => React.createElement(ScopeModal, props as DockProps),
    ),
  );
}
