import { Router } from "express";

export const demoRouter = Router();

demoRouter.get("/demo/login", (_request, response) => {
  response.type("html").send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Test Platform Demo Login</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 40px;
        color: #1f2937;
      }
      main {
        max-width: 420px;
      }
      label {
        display: block;
        margin-top: 16px;
      }
      input {
        box-sizing: border-box;
        display: block;
        margin-top: 6px;
        width: 100%;
        padding: 10px;
      }
      button {
        margin-top: 18px;
        padding: 10px 14px;
      }
      .login-trigger {
        display: inline-block;
        margin-top: 18px;
        padding: 10px 14px;
        border: 1px solid #6b7280;
        cursor: pointer;
        user-select: none;
      }
      #login-toggle {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      #welcome {
        display: none;
        margin-top: 18px;
        font-weight: 700;
      }
      #login-toggle:checked ~ #welcome {
        display: block;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Demo Login</h1>
      <label>
        用户名
        <input data-testid="demo-username" placeholder="请输入用户名" />
      </label>
      <label>
        密码
        <input data-testid="demo-password" placeholder="请输入密码" type="password" />
      </label>
      <input id="login-toggle" type="checkbox" />
      <label class="login-trigger" data-testid="demo-login-button" for="login-toggle">登录</label>
      <p id="welcome" data-testid="demo-welcome">登录成功，欢迎 admin</p>
    </main>
  </body>
</html>`);
});
