#!/usr/bin/env node
const { Command } = require("commander");
const http = require("http");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");

// --- CLI (Commander) ---
// node index.js --host 127.0.0.1 --port 3000 --cache ./cache
// npx nodemon index.js --host 127.0.0.1 --port 3000 --cache ./cache
// nodemon index.js --host 127.0.0.1 --port 3000 --cache ./cache
const program = new Command();
program
  .requiredOption("-h, --host <host>", "server host")
  .requiredOption("-p, --port <port>", "server port")
  .requiredOption("-c, --cache <dir>", "cache dir for photos");
program.parse(process.argv);
const { host, port, cache } = program.opts();
if (!fs.existsSync(cache)) fs.mkdirSync(cache, { recursive: true });

// --- App & middleware ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const upload = multer({ dest: cache });

// "БД" в пам'яті
let nextId = 1;
const inventory = new Map();

const buildItem = (item, req) => {
  const base = `${req.protocol}://${req.headers.host}`;
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    photoUrl: item.photoFilename ? `${base}/inventory/${item.id}/photo` : null
  };
};

// --- HTML форми ---
/** Форма реєстрації пристрою */
app.get("/RegisterForm.html", (req, res) =>
  res.sendFile(path.join(__dirname, "RegisterForm.html"))
);

/** Форма пошуку пристрою */
app.get("/SearchForm.html", (req, res) =>
  res.sendFile(path.join(__dirname, "SearchForm.html"))
);

// --- API ---
// POST /register
/** Реєстрація нового інвентаря (multipart/form-data) */
app.post("/register", upload.single("photo"), (req, res) => {
  const { inventory_name, description } = req.body;
  if (!inventory_name)
    return res.status(400).json({ error: "inventory_name is required" });

  const item = {
    id: String(nextId++),
    name: inventory_name,
    description: description || "",
    photoFilename: req.file ? req.file.filename : null
  };
  inventory.set(item.id, item);
  res.status(201).json(buildItem(item, req));
});

// GET /inventory
/** Список всіх речей */
app.get("/inventory", (req, res) =>
  res.json([...inventory.values()].map(i => buildItem(i, req)))
);

// GET /inventory/:id
/** Отримати річ по ID */
app.get("/inventory/:id", (req, res) => {
  const item = inventory.get(req.params.id);
  if (!item) return res.sendStatus(404);
  res.json(buildItem(item, req));
});

// PUT /inventory/:id
/** Оновити ім'я / опис речі */
app.put("/inventory/:id", (req, res) => {
  const item = inventory.get(req.params.id);
  if (!item) return res.sendStatus(404);
  const { name, description } = req.body;
  if (name !== undefined) item.name = name;
  if (description !== undefined) item.description = description;
  res.json(buildItem(item, req));
});

// GET /inventory/:id/photo
/** Отримати фото речі */
app.get("/inventory/:id/photo", (req, res) => {
  const item = inventory.get(req.params.id);
  if (!item || !item.photoFilename) return res.sendStatus(404);
  const filePath = path.join(cache, item.photoFilename);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);
  res.setHeader("Content-Type", "image/jpeg");
  fs.createReadStream(filePath).pipe(res);
});

// PUT /inventory/:id/photo
/** Оновити фото речі */
app.put("/inventory/:id/photo", upload.single("photo"), (req, res) => {
  const item = inventory.get(req.params.id);
  if (!item) return res.sendStatus(404);
  if (req.file) item.photoFilename = req.file.filename;
  res.json(buildItem(item, req));
});

// DELETE /inventory/:id
/** Видалити річ */
app.delete("/inventory/:id", (req, res) => {
  const ok = inventory.delete(req.params.id);
  if (!ok) return res.sendStatus(404);
  res.sendStatus(200);
});

// POST /search (x-www-form-urlencoded)
/** Пошук речі за ID з можливістю додати посилання на фото */
app.post("/search", (req, res) => {
  const { id, has_photo } = req.body;
  const item = inventory.get(id);
  if (!item) return res.sendStatus(404);

  let desc = item.description;
  if (has_photo && item.photoFilename) {
    desc += ` Photo: ${req.protocol}://${req.headers.host}/inventory/${item.id}/photo`;
  }
  res.json({ ...buildItem(item, req), description: desc });
});

// --- Swagger /docs ---
const swaggerDoc = {
  openapi: "3.0.0",
  info: { title: "Inventory API", version: "1.0.0" },
  servers: [{ url: `http://${host}:${port}` }],
  components: {
    schemas: {
      Inventory: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          photoUrl: { type: "string", nullable: true }
        }
      }
    }
  },
  paths: {
    "/register": {
      post: {
        summary: "Register inventory",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["inventory_name"],
                properties: {
                  inventory_name: { type: "string" },
                  description: { type: "string" },
                  photo: { type: "string", format: "binary" }
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: "Created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Inventory" }
              }
            }
          },
          400: { description: "Bad Request" }
        }
      }
    },
    "/inventory": {
      get: {
        summary: "List inventory",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Inventory" }
                }
              }
            }
          }
        }
      }
    },
    "/inventory/{id}": {
      get: {
        summary: "Get inventory by id",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Inventory" }
              }
            }
          },
          404: { description: "Not found" }
        }
      },
      put: {
        summary: "Update inventory",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "OK" },
          404: { description: "Not found" }
        }
      },
      delete: {
        summary: "Delete inventory",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: { description: "Deleted" },
          404: { description: "Not found" }
        }
      }
    },
    "/inventory/{id}/photo": {
      get: {
        summary: "Get photo",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: { description: "OK", content: { "image/jpeg": {} } },
          404: { description: "Not found" }
        }
      },
      put: {
        summary: "Update photo",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { photo: { type: "string", format: "binary" } }
              }
            }
          }
        },
        responses: {
          200: { description: "OK" },
          404: { description: "Not found" }
        }
      }
    },
    "/search": {
      post: {
        summary: "Search inventory by id",
        requestBody: {
          required: true,
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                required: ["id"],
                properties: {
                  id: { type: "string" },
                  has_photo: {
                    type: "string",
                    description: "any value if photo link required"
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Inventory" }
              }
            }
          },
          404: { description: "Not found" }
        }
      }
    }
  }
};
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));

// --- 405 / 404 ---
app.use((req, res) => {
  if (!["GET", "POST", "PUT", "DELETE"].includes(req.method))
    return res.sendStatus(405);
  res.sendStatus(404);
});

// --- HTTP server (модуль http за вимогою) ---
const server = http.createServer(app);
server.listen(port, host, () =>
  console.log(`Server running at http://${host}:${port}/`)
);
