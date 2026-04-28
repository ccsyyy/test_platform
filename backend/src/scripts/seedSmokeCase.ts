import { mysqlPool } from "../db/mysql.js";

async function upsertProject(): Promise<number> {
  await mysqlPool.query(
    `
    INSERT INTO tp_project (project_code, project_name, description)
    VALUES ('smoke-demo', '冒烟演示项目', '用于验证 API -> Redis -> Worker -> MySQL 的最小闭环')
    ON DUPLICATE KEY UPDATE
      project_name = VALUES(project_name),
      description = VALUES(description),
      status = 1,
      updated_at = NOW(3)
    `
  );
  const [rows] = await mysqlPool.query("SELECT id FROM tp_project WHERE project_code = 'smoke-demo'");
  return (rows as Array<{ id: number }>)[0].id;
}

async function upsertEnvironment(projectId: number): Promise<number> {
  await mysqlPool.query(
    `
    INSERT INTO tp_environment (
      project_id, env_code, env_name, env_type, base_url, allow_execution, require_confirm
    )
    VALUES (?, 'local-api', '本地 API Demo 环境', 'local', 'http://localhost:3000', 1, 0)
    ON DUPLICATE KEY UPDATE
      env_name = VALUES(env_name),
      env_type = VALUES(env_type),
      base_url = VALUES(base_url),
      allow_execution = VALUES(allow_execution),
      require_confirm = VALUES(require_confirm),
      updated_at = NOW(3)
    `,
    [projectId]
  );
  const [rows] = await mysqlPool.query(
    "SELECT id FROM tp_environment WHERE project_id = ? AND env_code = 'local-api'",
    [projectId]
  );
  return (rows as Array<{ id: number }>)[0].id;
}

async function upsertPage(projectId: number): Promise<number> {
  const [existing] = await mysqlPool.query(
    "SELECT id FROM tp_page WHERE project_id = ? AND page_name = 'Demo 登录页' LIMIT 1",
    [projectId]
  );
  const page = (existing as Array<{ id: number }>)[0];
  if (page) {
    await mysqlPool.query(
      "UPDATE tp_page SET url_pattern = '/demo/login', updated_at = NOW(3) WHERE id = ?",
      [page.id]
    );
    return page.id;
  }
  const [result] = await mysqlPool.query(
    `
    INSERT INTO tp_page (project_id, page_name, url_pattern, description)
    VALUES (?, 'Demo 登录页', '/demo/login', '本地冒烟测试页面')
    `,
    [projectId]
  );
  return Number((result as { insertId: number }).insertId);
}

async function upsertElement(input: {
  projectId: number;
  pageId: number;
  elementName: string;
  elementType: string;
  defaultAction: string;
  locatorValue: string;
}): Promise<number> {
  const [existing] = await mysqlPool.query(
    "SELECT id FROM tp_element WHERE project_id = ? AND page_id = ? AND element_name = ? AND status <> 0 LIMIT 1",
    [input.projectId, input.pageId, input.elementName]
  );
  const found = (existing as Array<{ id: number }>)[0];
  const attributes = JSON.stringify({ testId: input.locatorValue });

  let elementId: number;
  if (found) {
    elementId = found.id;
    await mysqlPool.query(
      `
      UPDATE tp_element
      SET element_type = ?, default_action = ?, attributes_json = CAST(? AS JSON), updated_at = NOW(3)
      WHERE id = ?
      `,
      [input.elementType, input.defaultAction, attributes, elementId]
    );
    await mysqlPool.query("DELETE FROM tp_element_locator WHERE element_id = ?", [elementId]);
  } else {
    const [result] = await mysqlPool.query(
      `
      INSERT INTO tp_element (
        project_id, page_id, element_name, element_type, default_action,
        source_url, attributes_json, valid_status
      )
      VALUES (?, ?, ?, ?, ?, '/demo/login', CAST(? AS JSON), 1)
      `,
      [
        input.projectId,
        input.pageId,
        input.elementName,
        input.elementType,
        input.defaultAction,
        attributes
      ]
    );
    elementId = Number((result as { insertId: number }).insertId);
  }

  const [locatorResult] = await mysqlPool.query(
    `
    INSERT INTO tp_element_locator (
      element_id, locator_type, locator_value, locator_expression,
      score, is_primary, is_unique, is_visible, is_actionable
    )
    VALUES (?, 'testId', ?, ?, 100, 1, 1, 1, 1)
    `,
    [elementId, input.locatorValue, `page.getByTestId('${input.locatorValue}')`]
  );
  const locatorId = Number((locatorResult as { insertId: number }).insertId);
  await mysqlPool.query("UPDATE tp_element SET primary_locator_id = ? WHERE id = ?", [
    locatorId,
    elementId
  ]);

  return elementId;
}

async function upsertCase(projectId: number): Promise<number> {
  await mysqlPool.query(
    `
    INSERT INTO tp_test_case (project_id, case_code, case_name, case_desc, priority, status)
    VALUES (?, 'SMOKE_LOGIN_001', 'Demo 登录冒烟用例', '验证本地 demo 登录页面可以显示欢迎语', 'high', 1)
    ON DUPLICATE KEY UPDATE
      case_name = VALUES(case_name),
      case_desc = VALUES(case_desc),
      priority = VALUES(priority),
      status = 1,
      updated_at = NOW(3)
    `,
    [projectId]
  );
  const [rows] = await mysqlPool.query(
    "SELECT id FROM tp_test_case WHERE project_id = ? AND case_code = 'SMOKE_LOGIN_001'",
    [projectId]
  );
  return (rows as Array<{ id: number }>)[0].id;
}

async function replaceSteps(input: {
  caseId: number;
  usernameElementId: number;
  passwordElementId: number;
  loginButtonElementId: number;
  welcomeElementId: number;
}): Promise<void> {
  await mysqlPool.query("DELETE FROM tp_case_step WHERE case_id = ?", [input.caseId]);
  const steps = [
    {
      order: 1,
      name: "打开登录页",
      action: "goto",
      elementId: null,
      dsl: { action: "goto", params: { url: "/demo/login" } },
      snapshot: null
    },
    {
      order: 2,
      name: "输入用户名",
      action: "fill",
      elementId: input.usernameElementId,
      dsl: { action: "fill", params: { value: "admin" } },
      snapshot: { type: "testId", value: "demo-username" }
    },
    {
      order: 3,
      name: "输入密码",
      action: "fill",
      elementId: input.passwordElementId,
      dsl: { action: "fill", params: { value: "demo-password" } },
      snapshot: { type: "testId", value: "demo-password" }
    },
    {
      order: 4,
      name: "点击登录",
      action: "click",
      elementId: input.loginButtonElementId,
      dsl: { action: "click", params: {} },
      snapshot: { type: "testId", value: "demo-login-button" }
    },
    {
      order: 5,
      name: "断言欢迎语",
      action: "assert",
      elementId: input.welcomeElementId,
      dsl: { action: "assert", params: { type: "containsText", text: "登录成功" } },
      snapshot: { type: "testId", value: "demo-welcome" }
    }
  ];

  for (const step of steps) {
    await mysqlPool.query(
      `
      INSERT INTO tp_case_step (
        case_id, step_order, step_name, action, element_id, step_dsl_json, locator_snapshot_json
      )
      VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))
      `,
      [
        input.caseId,
        step.order,
        step.name,
        step.action,
        step.elementId,
        JSON.stringify(step.dsl),
        JSON.stringify(step.snapshot)
      ]
    );
  }
}

async function main() {
  const projectId = await upsertProject();
  const environmentId = await upsertEnvironment(projectId);
  const pageId = await upsertPage(projectId);
  const usernameElementId = await upsertElement({
    projectId,
    pageId,
    elementName: "Demo 用户名输入框",
    elementType: "input",
    defaultAction: "fill",
    locatorValue: "demo-username"
  });
  const passwordElementId = await upsertElement({
    projectId,
    pageId,
    elementName: "Demo 密码输入框",
    elementType: "input",
    defaultAction: "fill",
    locatorValue: "demo-password"
  });
  const loginButtonElementId = await upsertElement({
    projectId,
    pageId,
    elementName: "Demo 登录按钮",
    elementType: "button",
    defaultAction: "click",
    locatorValue: "demo-login-button"
  });
  const welcomeElementId = await upsertElement({
    projectId,
    pageId,
    elementName: "Demo 欢迎语",
    elementType: "text",
    defaultAction: "assert",
    locatorValue: "demo-welcome"
  });
  const caseId = await upsertCase(projectId);
  await replaceSteps({
    caseId,
    usernameElementId,
    passwordElementId,
    loginButtonElementId,
    welcomeElementId
  });

  console.log(
    JSON.stringify(
      {
        projectId,
        environmentId,
        pageId,
        caseId
      },
      null,
      2
    )
  );
  await mysqlPool.end();
}

main().catch(async (error) => {
  console.error(error);
  await mysqlPool.end();
  process.exit(1);
});
