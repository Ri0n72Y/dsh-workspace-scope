/** dsh-workspace-scope — Client entry and slot registration. */
import { createElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import { ScopeBar } from "./components.js";
import type { ScopeBarProps, ScopeModalProps } from "./model.js";
import { ScopeModalSeat } from "./scope-modal.js";

export const name = "workspace-scope-client";
export const inject = ["slots"];

export function apply(ctx: Context): void {
  ctx.slots.inject("conversation.input.right", () =>
    ctx.slots.register(
      {
        name: "conversation.input.right",
        id: "workspace-scope",
        order: 30,
        label: "工作区能力",
      },
      (props: ScopeBarProps) => createElement(ScopeBar, props),
    ),
  );

  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      { name: "shell.overlay", id: "workspace-scope-modal", order: 50 },
      (props: ScopeModalProps) => createElement(ScopeModalSeat, props),
    ),
  );
}
