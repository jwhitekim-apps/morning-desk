// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: destructive, edit and management tools removed (read + create only).
import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry";

// 이 프로젝트의 위임 정책: 에이전트에게는 읽기와 태스크 "추가"만 준다.
// 도구가 코드에 존재하지 않으면 모델이 실수로도 부를 수 없다. 새 도구를 추가하려면 이 목록을 의도적으로 고쳐야 한다.
const ALLOWED = ["auth_status", "create_task", "get_task", "list_task_lists", "list_tasks", "list_tasks_due", "sign_in"];

describe("tool registry", () => {
  it("exposes exactly the allowed tool surface", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(ALLOWED);
  });

  it("has no destructive tools at all", () => {
    expect(allTools.filter((t) => t.risk === "destructive")).toEqual([]);
  });

  it("has no tool that edits, completes or deletes existing items", () => {
    const names = allTools.map((t) => t.name);
    for (const forbidden of ["update_task", "complete_task", "delete_task", "create_task_list", "update_task_list", "delete_task_list"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("list_tasks_due is a read tool, so it stays visible in read-only mode", () => {
    expect(allTools.find((t) => t.name === "list_tasks_due")?.risk).toBe("read");
  });

  it("has unique tool names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every tool a description, a valid risk class, and an input shape", () => {
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(["read", "write"]).toContain(tool.risk);
      expect(typeof tool.inputShape).toBe("object");
    }
  });
});
