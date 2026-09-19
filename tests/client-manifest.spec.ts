import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  dsh: {
    client: {
      platform: string;
      immediately?: boolean;
      inject?: string[];
    };
  };
};

describe("DSH client manifest", () => {
  it("uses alpha.2 package edges for the slots this plugin contributes to", () => {
    expect(manifest.dsh.client).toMatchObject({
      platform: "web",
      immediately: true,
      inject: [
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-layout",
      ],
    });
    expect(manifest.dsh.client.inject).not.toContain(
      "@deepseek-ai/dsh-client-ui-slots",
    );
  });
});
