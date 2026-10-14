import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT_DIR, "build");
const SPA_FALLBACK_FILE = path.join(BUILD_DIR, "spa.html");
const HOST = "127.0.0.1";
const PORT = 4173;

const BASE_URL = `http://${HOST}:${PORT}`;

/*
 * Chỉ prerender những trang public muốn Google index.
 *
 * KHÔNG thêm:
 * /login
 * /admin
 * /user
 * /employee
 * ...
 */
const ROUTES = [
  {
    path: "/",
    output: "index.html",
    canonical: "https://smarttechcloud.net/"
  },

  {
    path: "/news",
    output: "news/index.html",
    canonical: "https://smarttechcloud.net/news"
  }
];
const originalIndexFile = path.join(BUILD_DIR, "index.html");

if (!fs.existsSync(originalIndexFile)) {
  throw new Error(
    "Không tìm thấy build/index.html."
  );
}

/*
 * Giữ lại React SPA shell nguyên bản.
 *
 * File này dùng cho:
 * /login
 * /admin
 * /user
 * /employee
 * ...
 *
 * Không sử dụng homepage prerender làm SPA fallback.
 */
/*
 * Tạo SPA shell dành riêng cho các route private.
 *
 * Không để spa.html mang SEO homepage.
 */
let spaHtml = fs.readFileSync(
  originalIndexFile,
  "utf8"
);

/*
 * Title generic cho application.
 */
spaHtml = spaHtml.replace(
  /<title>[\s\S]*?<\/title>/i,
  "<title>Smarttech Cloud | Hệ thống quản lý</title>"
);

/*
 * Description generic.
 */
spaHtml = spaHtml.replace(
  /<meta\s+name=["']description["'][^>]*>/i,
  '<meta name="description" content="Hệ thống quản lý và giám sát thiết bị Smarttech Cloud." />'
);

/*
 * Thêm robots noindex trực tiếp vào HTML.
 * Nginx vẫn giữ X-Robots-Tag làm lớp bảo vệ thứ hai.
 */
if (
  !/<meta\s+name=["']robots["']/i.test(spaHtml)
) {
  spaHtml = spaHtml.replace(
    "</head>",
    '<meta name="robots" content="noindex,nofollow,noarchive" /></head>'
  );
}

fs.writeFileSync(
  SPA_FALLBACK_FILE,
  spaHtml,
  "utf8"
);

console.log(
  "[Prerender] Created private SPA fallback: spa.html"
);

console.log(
  "[Prerender] Created SPA fallback: spa.html"
);
/*
 * MIME type để server tạm có thể phục vụ
 * JS/CSS/images đúng Content-Type.
 */
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json"
};

/*
 * Kiểm tra file có nằm trong build/ hay không.
 * Tránh path traversal kiểu ../../
 */
function safeBuildPath(requestPath) {
  const cleanPath = requestPath
    .split("?")[0]
    .split("#")[0];

  let relativePath = decodeURIComponent(cleanPath);

  if (relativePath.startsWith("/")) {
    relativePath = relativePath.slice(1);
  }

  const resolved = path.resolve(BUILD_DIR, relativePath);

  if (!resolved.startsWith(BUILD_DIR)) {
    return null;
  }

  return resolved;
}

/*
 * Tạo static server rất nhỏ.
 *
 * Mục đích:
 * Puppeteer cần mở website giống browser thật.
 *
 * Nếu file không tồn tại:
 * trả build/index.html
 *
 * Đây chính là SPA fallback cho React Router.
 */
function createStaticServer() {
  return http.createServer((req, res) => {
    try {
      const requestUrl = req.url || "/";

      let filePath = safeBuildPath(requestUrl);

      if (!filePath) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      /*
       * /
       * hoặc thư mục
       */
      if (
        requestUrl === "/" ||
        requestUrl === ""
      ) {
        filePath = path.join(
          BUILD_DIR,
          "index.html"
        );
      }

      /*
       * Nếu file tồn tại và là directory,
       * thử index.html trong directory.
       */
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          const directoryIndex =
            path.join(filePath, "index.html");

          if (fs.existsSync(directoryIndex)) {
            filePath = directoryIndex;
          }
        }
      }

      /*
       * BrowserRouter:
       *
       * /news không phải file thật trước prerender,
       * nên fallback về build/index.html.
       */
     if (!fs.existsSync(filePath)) {
  filePath = SPA_FALLBACK_FILE;
}

      const extension =
        path.extname(filePath).toLowerCase();

      const contentType =
        MIME_TYPES[extension] ||
        "application/octet-stream";

      const content = fs.readFileSync(filePath);

      res.statusCode = 200;
      res.setHeader(
        "Content-Type",
        contentType
      );

      res.end(content);
    } catch (error) {
      console.error(
        "[Prerender Server] Error:",
        error
      );

      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });
}

/*
 * Đợi React render xong.
 */
async function waitForReact(page) {
  await page.waitForFunction(
    () => {
      const root =
        document.querySelector("#root");

      if (!root) {
        return false;
      }

      return (
        root.children.length > 0 ||
        root.textContent.trim().length > 0
      );
    },
    {
      timeout: 30000
    }
  );
}


async function waitForSeo(
  page,
  expectedCanonical
) {
  await page.waitForFunction(
    (canonical) => {
      const element =
        document.querySelector(
          'link[rel="canonical"]'
        );

      if (!element) {
        return false;
      }

      return (
        element.getAttribute("href") ===
        canonical
      );
    },
    {
      timeout: 30000
    },
    expectedCanonical
  );
}

/*
 * Tạo folder và ghi HTML.
 */
function writeHtml(
  relativeOutputPath,
  html
) {
  const outputFile =
    path.join(
      BUILD_DIR,
      relativeOutputPath
    );

  const outputDirectory =
    path.dirname(outputFile);

  fs.mkdirSync(
    outputDirectory,
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    outputFile,
    html,
    "utf8"
  );

  console.log(
    `[Prerender] Saved: ${relativeOutputPath}`
  );
}

/*
 * MAIN
 */
async function main() {
  if (!fs.existsSync(BUILD_DIR)) {
    throw new Error(
      "Không tìm thấy thư mục build/. " +
      "Hãy chạy react-scripts build trước."
    );
  }

  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    " SMARTTECH CLOUD PRERENDER"
  );
  console.log(
    "======================================"
  );
  console.log("");

  const server = createStaticServer();

  await new Promise((resolve) => {
    server.listen(
      PORT,
      HOST,
      resolve
    );
  });

  console.log(
    `[Prerender] Temporary server: ${BASE_URL}`
  );

  let browser;

  try {
    browser =
      await puppeteer.launch({
        headless: true,

        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox"
        ]
      });

    for (const route of ROUTES) {
      const page =
        await browser.newPage();

      /*
       * Desktop crawler viewport.
       */
      await page.setViewport({
        width: 1440,
        height: 900,
        deviceScaleFactor: 1
      });

      /*
       * Nếu API nào lỗi trong lúc prerender,
       * log ra để mình biết nhưng không làm browser crash.
       */
      page.on(
        "console",
        (message) => {
          const type = message.type();

          if (
            type === "error" ||
            type === "warning"
          ) {
            console.log(
              `[Browser ${route.path}]`,
              message.text()
            );
          }
        }
      );

      page.on(
        "pageerror",
        (error) => {
          console.error(
            `[Browser Error ${route.path}]`,
            error.message
          );
        }
      );

      const url =
        `${BASE_URL}${route.path}`;

      console.log("");
      console.log(
        `[Prerender] Rendering: ${route.path}`
      );

      await page.goto(
        url,
        {
          waitUntil: "domcontentloaded",
          timeout: 60000
        }
      );

      /*
       * Đợi React mount.
       */
      await waitForReact(page);

      /*
       * Đợi SEO component chạy.
       */
      await waitForSeo(
        page,
        route.canonical
      );

      /*
       * Cho animation/useEffect nhỏ hoàn tất.
       *
       * Không dùng networkidle0 vì project của bạn
       * có API/SignalR/provider có thể giữ connection.
       */
      await new Promise(
        (resolve) =>
          setTimeout(resolve, 1000)
      );

      /*
       * Lấy DOM hoàn chỉnh SAU KHI React render.
       */
      const html =
        await page.content();

      writeHtml(
        route.output,
        html
      );

      /*
       * Log để kiểm tra SEO.
       */
      const result =
        await page.evaluate(() => {
          const description =
            document.querySelector(
              'meta[name="description"]'
            );

          const robots =
            document.querySelector(
              'meta[name="robots"]'
            );

          const canonical =
            document.querySelector(
              'link[rel="canonical"]'
            );

          const h1 =
            document.querySelector("h1");

          return {
            title: document.title,

            description:
              description?.getAttribute(
                "content"
              ) || null,

            robots:
              robots?.getAttribute(
                "content"
              ) || null,

            canonical:
              canonical?.getAttribute(
                "href"
              ) || null,

            h1:
              h1?.textContent?.trim() ||
              null
          };
        });

      console.log(
        `[Prerender] Title     : ${result.title}`
      );

      console.log(
        `[Prerender] Canonical : ${result.canonical}`
      );

      console.log(
        `[Prerender] Robots    : ${result.robots}`
      );

      console.log(
        `[Prerender] H1        : ${result.h1}`
      );

      await page.close();
    }

    console.log("");
    console.log(
      "======================================"
    );
    console.log(
      " PRERENDER COMPLETED"
    );
    console.log(
      "======================================"
    );
    console.log("");
  } finally {
    if (browser) {
      await browser.close();
    }

    await new Promise(
      (resolve) =>
        server.close(resolve)
    );
  }
}

main().catch((error) => {
  console.error("");
  console.error(
    "[Prerender] FAILED"
  );

  console.error(error);

  process.exit(1);
});