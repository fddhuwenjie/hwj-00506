const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');

const BACKEND_PORT = 8506;
const FRONTEND_PORT = 3506;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const dbPath = path.join(__dirname, 'repair_shop.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS technicians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    specialty TEXT,
    hourly_rate REAL DEFAULT 100
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_number TEXT NOT NULL UNIQUE,
    brand_model TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    mileage INTEGER DEFAULT 0,
    purchase_date TEXT,
    vin TEXT,
    insurance_expiry TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    stock INTEGER DEFAULT 0,
    cost_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    compatible_models TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS maintenance_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    last_mileage INTEGER DEFAULT 0,
    last_date TEXT,
    interval_mileage INTEGER,
    interval_days INTEGER,
    next_mileage INTEGER,
    next_date TEXT,
    status TEXT DEFAULT 'normal',
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS repair_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    vehicle_id INTEGER NOT NULL,
    fault_description TEXT,
    receive_time TEXT,
    expected_delivery TEXT,
    technician_id INTEGER,
    labor_fee REAL DEFAULT 0,
    status TEXT DEFAULT 'pending_diagnosis',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    is_rework INTEGER DEFAULT 0,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    FOREIGN KEY (technician_id) REFERENCES technicians(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS repair_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    labor_hours REAL DEFAULT 0,
    labor_fee REAL DEFAULT 0,
    description TEXT,
    FOREIGN KEY (order_id) REFERENCES repair_orders(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS order_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES repair_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (part_id) REFERENCES parts(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE,
    labor_total REAL DEFAULT 0,
    parts_total REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    receivable_amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    debt_status TEXT DEFAULT 'unpaid',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES repair_orders(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payment_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT,
    payment_time TEXT DEFAULT CURRENT_TIMESTAMP,
    remark TEXT,
    FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES repair_orders(id) ON DELETE CASCADE
  )`);
});

function generateOrderNo() {
  const d = new Date();
  const pad = n => n.toString().padStart(2, '0');
  return `WO${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${Math.floor(Math.random()*1000)}`;
}

function seedData() {
  db.get('SELECT COUNT(*) as cnt FROM technicians', (err, row) => {
    if (err) { console.error('数据库检查失败:', err); return; }
    if (row.cnt === 0) {
      console.log('数据库为空，请先运行: node init-db.js');
    } else {
      console.log(`数据检查通过: 技师${row.cnt}名 + 其他预置数据就绪`);
    }
  });
}


app.get('/api/vehicles', (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM vehicles ORDER BY id DESC';
  let params = [];
  if (search) {
    sql = 'SELECT * FROM vehicles WHERE plate_number LIKE ? OR owner_name LIKE ? ORDER BY id DESC';
    params = [`%${search}%`, `%${search}%`];
  }
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/vehicles/:id', (req, res) => {
  db.get('SELECT * FROM vehicles WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

app.post('/api/vehicles', (req, res) => {
  const { plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry } = req.body;
  const sql = 'INSERT INTO vehicles (plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  db.run(sql, [plate_number, brand_model, owner_name, phone, mileage || 0, purchase_date, vin, insurance_expiry], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put('/api/vehicles/:id', (req, res) => {
  const { plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry } = req.body;
  const sql = 'UPDATE vehicles SET plate_number=?, brand_model=?, owner_name=?, phone=?, mileage=?, purchase_date=?, vin=?, insurance_expiry=? WHERE id=?';
  db.run(sql, [plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

app.delete('/api/vehicles/:id', (req, res) => {
  db.run('DELETE FROM vehicles WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

app.get('/api/technicians', (req, res) => {
  db.all('SELECT * FROM technicians ORDER BY id', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/parts', (req, res) => {
  const { search, lowStock } = req.query;
  let sql = 'SELECT * FROM parts WHERE 1=1';
  let params = [];
  if (search) {
    sql += ' AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (lowStock === 'true') {
    sql += ' AND stock < 10';
  }
  sql += ' ORDER BY id DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/parts/:id', (req, res) => {
  db.get('SELECT * FROM parts WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

app.post('/api/parts', (req, res) => {
  const { sku, name, category, stock, cost_price, sell_price, compatible_models } = req.body;
  const sql = 'INSERT INTO parts (sku, name, category, stock, cost_price, sell_price, compatible_models) VALUES (?, ?, ?, ?, ?, ?, ?)';
  db.run(sql, [sku, name, category, stock || 0, cost_price || 0, sell_price || 0, compatible_models], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put('/api/parts/:id', (req, res) => {
  const { sku, name, category, stock, cost_price, sell_price, compatible_models } = req.body;
  const sql = 'UPDATE parts SET sku=?, name=?, category=?, stock=?, cost_price=?, sell_price=?, compatible_models=? WHERE id=?';
  db.run(sql, [sku, name, category, stock, cost_price, sell_price, compatible_models, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

app.delete('/api/parts/:id', (req, res) => {
  db.run('DELETE FROM parts WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

app.put('/api/parts/:id/restock', (req, res) => {
  const { quantity } = req.body;
  db.run('UPDATE parts SET stock = stock + ? WHERE id = ?', [quantity, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

app.get('/api/repair-orders', (req, res) => {
  const { status, vehicle_id } = req.query;
  let sql = `SELECT ro.*, v.plate_number, v.brand_model, v.owner_name, v.phone, t.name as technician_name
             FROM repair_orders ro
             LEFT JOIN vehicles v ON ro.vehicle_id = v.id
             LEFT JOIN technicians t ON ro.technician_id = t.id
             WHERE 1=1`;
  let params = [];
  if (status) { sql += ' AND ro.status = ?'; params.push(status); }
  if (vehicle_id) { sql += ' AND ro.vehicle_id = ?'; params.push(vehicle_id); }
  sql += ' ORDER BY ro.id DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/repair-orders/:id', (req, res) => {
  const oid = req.params.id;
  db.get(`SELECT ro.*, v.plate_number, v.brand_model, v.owner_name, v.phone, v.mileage,
          t.name as technician_name, t.hourly_rate
          FROM repair_orders ro
          LEFT JOIN vehicles v ON ro.vehicle_id = v.id
          LEFT JOIN technicians t ON ro.technician_id = t.id
          WHERE ro.id = ?`, [oid], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: '工单不存在' });
    db.all('SELECT * FROM repair_items WHERE order_id = ?', [oid], (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all(`SELECT op.*, p.name as part_name, p.sku, p.stock
              FROM order_parts op LEFT JOIN parts p ON op.part_id = p.id
              WHERE op.order_id = ?`, [oid], (err, parts) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ...order, items, parts });
      });
    });
  });
});

app.post('/api/repair-orders', (req, res) => {
  const { vehicle_id, fault_description, receive_time, expected_delivery, technician_id, items } = req.body;
  const orderNo = generateOrderNo();
  let laborFee = 0;
  (items || []).forEach(it => laborFee += (it.labor_fee || 0));
  
  db.run('BEGIN TRANSACTION');
  db.run(`INSERT INTO repair_orders (order_no, vehicle_id, fault_description, receive_time, expected_delivery, technician_id, labor_fee, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_diagnosis')`,
    [orderNo, vehicle_id, fault_description, receive_time, expected_delivery, technician_id, laborFee],
    function(err) {
      if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
      const oid = this.lastID;
      const stmt = db.prepare('INSERT INTO repair_items (order_id, item_name, labor_hours, labor_fee, description) VALUES (?, ?, ?, ?, ?)');
      (items || []).forEach(it => stmt.run([oid, it.item_name, it.labor_hours || 0, it.labor_fee || 0, it.description || '']));
      stmt.finalize();
      db.run('COMMIT');
      res.json({ id: oid, order_no: orderNo });
    }
  );
});

app.put('/api/repair-orders/:id', (req, res) => {
  const { vehicle_id, fault_description, receive_time, expected_delivery, technician_id, status, items } = req.body;
  let laborFee = 0;
  (items || []).forEach(it => laborFee += (it.labor_fee || 0));
  const oid = req.params.id;

  db.serialize(() => {
    db.run(`UPDATE repair_orders SET vehicle_id=?, fault_description=?, receive_time=?, expected_delivery=?, technician_id=?, status=?, labor_fee=? WHERE id=?`,
      [vehicle_id, fault_description, receive_time, expected_delivery, technician_id, status, laborFee, oid],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
      }
    );
    db.run('DELETE FROM repair_items WHERE order_id = ?', [oid]);
    if (items && items.length > 0) {
      const stmt = db.prepare('INSERT INTO repair_items (order_id, item_name, labor_hours, labor_fee, description) VALUES (?, ?, ?, ?, ?)');
      items.forEach(it => stmt.run([oid, it.item_name, it.labor_hours || 0, it.labor_fee || 0, it.description || '']));
      stmt.finalize();
    }
    res.json({ ok: true });
  });
});

app.post('/api/repair-orders/:id/add-item', (req, res) => {
  const { item_name, labor_hours, labor_fee, description } = req.body;
  const oid = req.params.id;
  db.run('INSERT INTO repair_items (order_id, item_name, labor_hours, labor_fee, description) VALUES (?, ?, ?, ?, ?)',
    [oid, item_name, labor_hours || 0, labor_fee || 0, description || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.run('UPDATE repair_orders SET labor_fee = labor_fee + ? WHERE id = ?', [labor_fee || 0, oid]);
      res.json({ id: this.lastID });
    }
  );
});

app.post('/api/repair-orders/:id/add-part', (req, res) => {
  const { part_id, quantity } = req.body;
  const oid = req.params.id;
  db.get('SELECT sell_price, stock FROM parts WHERE id = ?', [part_id], (err, part) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!part) return res.status(404).json({ error: '配件不存在' });
    const subtotal = part.sell_price * quantity;
    db.run('INSERT INTO order_parts (order_id, part_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)',
      [oid, part_id, quantity, part.sell_price, subtotal],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, subtotal });
      }
    );
  });
});

app.delete('/api/repair-orders/:id/parts/:pid', (req, res) => {
  db.run('DELETE FROM order_parts WHERE id = ? AND order_id = ?', [req.params.pid, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

app.put('/api/repair-orders/:id/status', (req, res) => {
  const { status } = req.body;
  db.run('UPDATE repair_orders SET status = ? WHERE id = ?', [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

app.get('/api/maintenance-plans', (req, res) => {
  const { vehicle_id, status } = req.query;
  let sql = `SELECT mp.*, v.plate_number, v.brand_model, v.owner_name, v.mileage as current_mileage
             FROM maintenance_plans mp LEFT JOIN vehicles v ON mp.vehicle_id = v.id WHERE 1=1`;
  let params = [];
  if (vehicle_id) { sql += ' AND mp.vehicle_id = ?'; params.push(vehicle_id); }
  if (status) { sql += ' AND mp.status = ?'; params.push(status); }
  sql += ' ORDER BY mp.id DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const today = new Date();
    const result = rows.map(r => {
      let st = r.status;
      if (r.next_mileage <= r.current_mileage || new Date(r.next_date) <= today) {
        st = 'due';
      } else if (r.next_mileage - r.current_mileage < 2000) {
        st = 'upcoming';
      }
      return { ...r, status: st };
    });
    res.json(result);
  });
});

app.post('/api/maintenance-plans/:id/complete', (req, res) => {
  const { current_mileage } = req.body;
  const mid = req.params.id;
  db.get('SELECT * FROM maintenance_plans WHERE id = ?', [mid], (err, plan) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!plan) return res.status(404).json({ error: '保养计划不存在' });
    const today = new Date().toISOString().split('T')[0];
    const nextMil = (current_mileage || plan.last_mileage) + (plan.interval_mileage || 0);
    const nextDate = new Date(new Date(today).getTime() + (plan.interval_days || 0) * 86400000).toISOString().split('T')[0];
    db.run(`UPDATE maintenance_plans SET last_mileage=?, last_date=?, next_mileage=?, next_date=?, status='normal' WHERE id=?`,
      [current_mileage || plan.last_mileage, today, nextMil, nextDate, mid],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, next_mileage: nextMil, next_date: nextDate });
      }
    );
  });
});

app.post('/api/settlements', (req, res) => {
  const { order_id, discount } = req.body;
  const oid = order_id;

  db.get(`SELECT ro.labor_fee, ro.status FROM repair_orders ro WHERE ro.id = ?`, [oid], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: '工单不存在' });
    if (order.status !== 'pending_settlement' && order.status !== 'completed') {
      return res.status(400).json({ error: '工单状态不允许结算' });
    }
    db.all(`SELECT op.part_id, op.quantity, p.stock FROM order_parts op LEFT JOIN parts p ON op.part_id = p.id WHERE op.order_id = ?`, [oid], (err, orderParts) => {
      if (err) return res.status(500).json({ error: err.message });
      const insufficient = orderParts.filter(op => op.stock < op.quantity);
      if (insufficient.length > 0) {
        db.all(`SELECT p.*, op.quantity as required, (op.quantity - p.stock) as shortage
                FROM order_parts op LEFT JOIN parts p ON op.part_id = p.id
                WHERE op.order_id = ? AND p.stock < op.quantity`, [oid], (err, shortageParts) => {
          return res.status(400).json({ error: '库存不足，无法结算', shortage_parts: shortageParts, suggestion: '建议及时采购以上缺件' });
        });
        return;
      }
      db.get(`SELECT COALESCE(SUM(subtotal), 0) as parts_total FROM order_parts WHERE order_id = ?`, [oid], (err, partsRow) => {
        if (err) return res.status(500).json({ error: err.message });
        const partsTotal = partsRow.parts_total;
        const laborTotal = order.labor_fee;
        const disc = discount || 0;
        const receivable = laborTotal + partsTotal - disc;
        db.run(`INSERT OR REPLACE INTO settlements (order_id, labor_total, parts_total, discount, receivable_amount, paid_amount, debt_status)
                VALUES (?, ?, ?, ?, ?, COALESCE((SELECT paid_amount FROM settlements WHERE order_id = ?), 0),
                CASE WHEN COALESCE((SELECT paid_amount FROM settlements WHERE order_id = ?), 0) >= ? THEN 'paid' ELSE 'unpaid' END)`,
          [oid, laborTotal, partsTotal, disc, receivable, oid, oid, receivable],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            db.run('UPDATE repair_orders SET status = ? WHERE id = ?', ['pending_settlement', oid]);
            res.json({ order_id: oid, labor_total: laborTotal, parts_total: partsTotal, discount: disc, receivable_amount: receivable });
          }
        );
      });
    });
  });
});

app.get('/api/settlements/:orderId', (req, res) => {
  db.get(`SELECT s.*, ro.order_no, v.plate_number, v.owner_name, v.phone, ro.status as order_status
          FROM settlements s
          LEFT JOIN repair_orders ro ON s.order_id = ro.id
          LEFT JOIN vehicles v ON ro.vehicle_id = v.id
          WHERE s.order_id = ?`, [req.params.orderId], (err, settle) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!settle) return res.status(404).json({ error: '结算单不存在' });
    db.all('SELECT * FROM payment_records WHERE settlement_id = ? ORDER BY payment_time DESC', [settle.id], (err, payments) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get('SELECT * FROM reviews WHERE order_id = ?', [req.params.orderId], (err, review) => {
        res.json({ ...settle, payments, review });
      });
    });
  });
});

app.post('/api/settlements/:orderId/pay', (req, res) => {
  const { amount, payment_method, remark } = req.body;
  db.get('SELECT * FROM settlements WHERE order_id = ?', [req.params.orderId], (err, settle) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!settle) return res.status(404).json({ error: '结算单不存在' });
    const newPaid = (settle.paid_amount || 0) + amount;
    const debtStatus = newPaid >= settle.receivable_amount ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
    db.run('INSERT INTO payment_records (settlement_id, amount, payment_method, remark) VALUES (?, ?, ?, ?)',
      [settle.id, amount, payment_method || '现金', remark || ''],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run('UPDATE settlements SET paid_amount = ?, debt_status = ? WHERE id = ?',
          [newPaid, debtStatus, settle.id],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (debtStatus === 'paid') {
              db.run('UPDATE repair_orders SET status = ? WHERE id = ?', ['completed', req.params.orderId]);
              db.all(`SELECT op.part_id, op.quantity FROM order_parts op WHERE op.order_id = ?`, [req.params.orderId], (err, ops) => {
                if (!err && ops) {
                  ops.forEach(op => {
                    db.run('UPDATE parts SET stock = stock - ? WHERE id = ?', [op.quantity, op.part_id]);
                  });
                }
              });
            }
            res.json({ ok: true, paid_amount: newPaid, debt_status: debtStatus });
          }
        );
      }
    );
  });
});

app.post('/api/reviews', (req, res) => {
  const { order_id, rating, comment } = req.body;
  db.run(`INSERT OR REPLACE INTO reviews (order_id, rating, comment, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    [order_id, rating, comment || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.get('/api/stats/monthly-revenue', (req, res) => {
  const { month } = req.query;
  let sql = `SELECT strftime('%Y-%m', ro.created_at) as month,
             SUM(s.labor_total) as labor_total,
             SUM(s.parts_total) as parts_total,
             SUM(s.discount) as discount,
             SUM(s.receivable_amount) as total_revenue
             FROM settlements s LEFT JOIN repair_orders ro ON s.order_id = ro.id
             GROUP BY month ORDER BY month DESC LIMIT 12`;
  if (month) {
    sql = `SELECT SUM(s.labor_total) as labor_total,
           SUM(s.parts_total) as parts_total,
           SUM(s.discount) as discount,
           SUM(s.receivable_amount) as total_revenue,
           COUNT(*) as order_count
           FROM settlements s LEFT JOIN repair_orders ro ON s.order_id = ro.id
           WHERE strftime('%Y-%m', ro.created_at) = ?`;
    db.get(sql, [month], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row || { labor_total: 0, parts_total: 0, discount: 0, total_revenue: 0, order_count: 0 });
    });
    return;
  }
  db.all(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/stats/parts-ranking', (req, res) => {
  db.all(`SELECT p.id, p.sku, p.name, p.category,
          SUM(op.quantity) as total_quantity,
          SUM(op.subtotal) as total_amount
          FROM order_parts op
          LEFT JOIN parts p ON op.part_id = p.id
          GROUP BY p.id ORDER BY total_quantity DESC LIMIT 10`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get('/api/stats/technician-ranking', (req, res) => {
  db.all(`SELECT t.id, t.name, t.specialty,
          COUNT(DISTINCT ro.id) as order_count,
          SUM(ri.labor_hours) as total_hours,
          SUM(ri.labor_fee) as total_income
          FROM technicians t
          LEFT JOIN repair_orders ro ON ro.technician_id = t.id
          LEFT JOIN repair_items ri ON ri.order_id = ro.id
          GROUP BY t.id ORDER BY total_hours DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get('/api/stats/rework-rate', (req, res) => {
  db.get(`SELECT COUNT(*) as total,
          SUM(CASE WHEN is_rework = 1 THEN 1 ELSE 0 END) as rework_count,
          ROUND(SUM(CASE WHEN is_rework = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as rework_rate
          FROM repair_orders WHERE status != 'cancelled'`,
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row);
    }
  );
});

app.get('/api/stats/insurance-expiring', (req, res) => {
  const { days } = req.query;
  const d = days || 30;
  db.all(`SELECT v.*, JULIANDAY(insurance_expiry) - JULIANDAY('now') as days_left
          FROM vehicles v
          WHERE JULIANDAY(insurance_expiry) - JULIANDAY('now') BETWEEN 0 AND ?
          ORDER BY insurance_expiry ASC`, [d],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get('/api/stats/maintenance-due', (req, res) => {
  const today = new Date();
  db.all(`SELECT mp.*, v.plate_number, v.brand_model, v.owner_name, v.mileage as current_mileage,
          (mp.next_mileage - v.mileage) as mileage_left,
          JULIANDAY(mp.next_date) - JULIANDAY('now') as days_left
          FROM maintenance_plans mp LEFT JOIN vehicles v ON mp.vehicle_id = v.id
          WHERE mp.next_mileage <= v.mileage + 2000 OR JULIANDAY(mp.next_date) - JULIANDAY('now') <= 30
          ORDER BY (CASE WHEN mp.next_mileage <= v.mileage THEN 0 ELSE 1 END), mp.next_date ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const result = rows.map(r => ({
        ...r,
        status: (r.next_mileage <= r.current_mileage || r.days_left <= 0) ? 'due' : 'upcoming'
      }));
      const count = result.filter(r => r.status === 'due').length;
      const upcoming = result.filter(r => r.status === 'upcoming').length;
      res.json({ total: result.length, due_count: count, upcoming_count: upcoming, items: result });
    }
  );
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(BACKEND_PORT, () => {
  console.log(`后端API服务已启动: http://localhost:${BACKEND_PORT}`);
  seedData();
});

const frontendApp = express();
frontendApp.use(express.static(path.join(__dirname, 'public')));
frontendApp.use('/api', createProxyMiddleware({ target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true }));
frontendApp.listen(FRONTEND_PORT, () => {
  console.log(`前端服务已启动: http://localhost:${FRONTEND_PORT}`);
});
