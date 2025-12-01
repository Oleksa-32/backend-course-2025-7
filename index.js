#!/usr/bin/env node
require("dotenv").config();

const http = require("http");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");
const { Pool } = require("pg");

// --- Config from .env ---
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const CACHE_DIR = process.env.CACHE_DIR || "./cache";
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// --- DB pool ---
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  user: process.env.DB_USER || "inventory_user",
  password: process.env.DB_PASSWORD || "inventory_pass",
  database: process.env.DB_NAME || "inventory_db"
});

// --- App & middleware ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const upload = multer({ dest: CACHE_DIR });

const buildItem = (row, req) => {
  const base = `${req.protocol}://${req.headers.host}`;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    photoUrl: row.photo_filename ? `${base}/inventory/${row.id}/photo` : null
  };
};

// --- HTML forms ---
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
app.post("/register", upload.single("photo"), async (req, res) => {
  const { inventory_name, description } = req.body;
  if (!inventory_name) {
    return res.status(400).json({ error: "inventory_name is required" });
  }

  const photoFilename = req.file ? req.file.filename : null;

  try {
    const result = await pool.query(
      `INSERT INTO inventory (name, description, photo_filename)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [inventory_name, description || "", photoFilename]
    );
    const item = result.rows[0];
    res.status(201).json(buildItem(item, req));
  } catch (err) {
    console.error("Error inserting inventory:", err);
    res.sendStatus(500);
  }
});

// GET /inventory
/** Список всіх речей */
app.get("/inventory", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM inventory ORDER BY id");
    res.json(result.rows.map(row => buildItem(row, req)));
  } catch (err) {
    console.error("Error fetching inventory:", err);
    res.sendStatus(500);
  }
});

// GET /inventory/:id
/** Отримати річ по ID */
app.get("/inventory/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.sendStatus(400);

  try {
    const result = await pool.query("SELECT * FROM inventory WHERE id = $1", [
      id
    ]);
    if (result.rows.length === 0) return res.sendStatus(404);
    res.json(buildItem(result.rows[0], req));
  } catch (err) {
    console.error("Error fetching inventory by id:", err);
    res.sendStatus(500);
  }
});

// PUT /inventory/:id
/** Оновити ім'я / опис речі */
app.put("/inventory/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.sendStatus(400);

  const { name, description } = req.body;

  try {
    // Отримаємо поточний запис
    const current = await pool.query("SELECT * FROM inventory WHERE id = $1", [
      id
    ]);
    if (current.rows.length === 0) return res.sendStatus(404);

    const row = current.rows[0];
    const newName = name !== undefined ? name : row.name;
    const newDescription =
      description !== undefined ? description : row.description;

    const result = await pool.query(
      `UPDATE inventory
       SET name = $1, description = $2
       WHERE id = $3
       RETURNING *`,
      [newName, newDescription, id]
    );

    res.json(buildItem(result.rows[0], req));
  } catch (err) {
    console.error("Error updating inventory:", err);
    res.sendStatus(500);
  }
});

// GET /inventory/:id/photo
/** Отримати фото речі */
app.get("/inventory/:id/photo", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.sendStatus(400);

  try {
    const result = await pool.query(
      "SELECT photo_filename FROM inventory WHERE id = $1",
      [id]
    );
    if (result.rows.length === 0) return res.sendStatus(404);

    const { photo_filename } = result.rows[0];
    if (!photo_filename) return res.sendStatus(404);

    const filePath = path.join(CACHE_DIR, photo_filename);
    if (!fs.existsSync(filePath)) return res.sendStatus(404);

    res.setHeader("Content-Type", "image/jpeg");
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("Error fetching photo:", err);
    res.sendStatus(500);
  }
});

// PUT /inventory/:id/photo
/** Оновити фото речі */
app.put("/inventory/:id/photo", upload.single("photo"), async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.sendStatus(400);
  if (!req.file) return res.status(400).json({ error: "photo is required" });

  try {
    const current = await pool.query("SELECT * FROM inventory WHERE id = $1", [
      id
    ]);
    if (current.rows.length === 0) return res.sendStatus(404);

    const photoFilename = req.file.filename;

    const result = await pool.query(
      `UPDATE inventory
       SET photo_filename = $1
       WHERE id = $2
       RETURNING *`,
      [photoFilename, id]
    );

    res.json(buildItem(result.rows[0], req));
  } catch (err) {
    console.error("Error updating photo:", err);
    res.sendStatus(500);
  }
});

// DELETE /inventory/:id
/** Видалити річ */
app.delete("/inventory/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.sendStatus(400);

  try {
    const result = await pool.query(
      "DELETE FROM inventory WHERE id = $1",
      [id]
    );
    if (result.rowCount === 0) return res.sendStatus(404);
    res.sendStatus(200);
  } catch (err) {
    console.error("Error deleting inventory:", err);
    res.sendStatus(500);
  }
});

// POST /search (x-www-form-urlencoded)
/** Пошук речі за ID з можливістю додати посилання на фото */
app.post("/search", async (req, res) => {
  const { id, has_photo } = req.body;
  const numId = Number(id);
  if (Number.isNaN(numId)) return res.sendStatus(400);

  try {
    const result = await pool.query("SELECT * FROM inventory WHERE id = $1", [
      numId
    ]);
    if (result.rows.length === 0) return res.sendStatus(404);

    const row = result.rows[0];
    let desc = row.description || "";

    if (has_photo && row.photo_filename) {
      desc += ` Photo: ${req.protocol}://${req.headers.host}/inventory/${row.id}/photo`;
    }

    res.json({ ...buildItem(row, req), description: desc });
  } catch (err) {
    console.error("Error searching inventory:", err);
    res.sendStatus(500);
  }
});

// --- Swagger /docs ---
const swaggerDoc = {
  openapi: "3.0.0",
  info: { title: "Inventory API", version: "1.0.0" },
  servers: [{ url: `http://localhost:${PORT}` }],
  components: {
    schemas: {
      Inventory: {
        type: "object",
        properties: {
          id: { type: "integer" },
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
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
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
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
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
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
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
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: {
          200: { description: "OK", content: { "image/jpeg": {} } },
          404: { description: "Not found" }
        }
      },
      put: {
        summary: "Update photo",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
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
  if (!["GET", "POST", "PUT", "DELETE"].includes(req.method)) {
    return res.sendStatus(405);
  }
  res.sendStatus(404);
});

// --- HTTP server ---
const server = http.createServer(app);
server.listen(PORT, HOST, () =>
  console.log(`Server running at http://${HOST}:${PORT}/`)
);
