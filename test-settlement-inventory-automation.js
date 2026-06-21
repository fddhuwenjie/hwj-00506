const http = require('http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const TEST_PREFIX = 'TEST_AUTO_';
const TEST_DB_PATH = path.join(__dirname, 'test_repair_shop.db');
const ORIGINAL_DB_PATH = path.join(__dirname, 'repair_shop.db');
const TEST_API_PORT = 18506;

let testServer = null;
let testDb = null;
let testAppDb = null;
let createdTestIds = {
  vehicles: [],
  technicians: [],
  parts: [],
  repairOrders: [],
  maintenancePlans: [],
  settlements: [],
  paymentRecords: [],
  settlementAdjustments: [],
  inventoryDeductionRecords: []
};

function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TEST_API_PORT,
      path: '/api' + path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

let passed = 0;
let failed = 0;
const results = [];
const testStartTime = Date.now();

function test(name, fn) {
  results.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || '断言失败');
  }
}

function assertApproxEqual(actual, expected, epsilon = 0.01, message) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(message || `数值不匹配: 期望 ${expected}, 实际 ${actual}`);
  }
}

function generateOrderNo() {
  const d = new Date();
  const pad = n => n.toString().padStart(2, '0');
  return `WO${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${Math.floor(Math.random()*1000)}`;
}

async function setupTestServer() {
  console.log('  [准备] 初始化测试数据库和服务器...');
  
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  
  if (fs.existsSync(ORIGINAL_DB_PATH)) {
    fs.copyFileSync(ORIGINAL_DB_PATH, TEST_DB_PATH);
    console.log('  [准备] 已复制原始数据库作为测试基础');
  }
  
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  
  testAppDb = new sqlite3.Database(TEST_DB_PATH);
  await runSql(testAppDb, 'PRAGMA foreign_keys = ON');
  
  testDb = testAppDb;

  app.get('/api/vehicles', (req, res) => {
    const { search } = req.query;
    let sql = 'SELECT * FROM vehicles ORDER BY id DESC';
    let params = [];
    if (search) {
      sql = 'SELECT * FROM vehicles WHERE plate_number LIKE ? OR owner_name LIKE ? ORDER BY id DESC';
      params = [`%${search}%`, `%${search}%`];
    }
    testAppDb.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.get('/api/vehicles/:id', (req, res) => {
    testAppDb.get('SELECT * FROM vehicles WHERE id = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row);
    });
  });

  app.post('/api/vehicles', (req, res) => {
    const { plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry } = req.body;
    const sql = 'INSERT INTO vehicles (plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    testAppDb.run(sql, [plate_number, brand_model, owner_name, phone, mileage || 0, purchase_date, vin, insurance_expiry], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    });
  });

  app.get('/api/technicians', (req, res) => {
    testAppDb.all('SELECT * FROM technicians ORDER BY id', (err, rows) => {
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
    testAppDb.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.get('/api/parts/:id', (req, res) => {
    testAppDb.get('SELECT * FROM parts WHERE id = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row);
    });
  });

  app.post('/api/parts', (req, res) => {
    const { sku, name, category, stock, cost_price, sell_price, compatible_models } = req.body;
    const sql = 'INSERT INTO parts (sku, name, category, stock, cost_price, sell_price, compatible_models) VALUES (?, ?, ?, ?, ?, ?, ?)';
    testAppDb.run(sql, [sku, name, category, stock || 0, cost_price || 0, sell_price || 0, compatible_models], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
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
    testAppDb.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.get('/api/repair-orders/:id', (req, res) => {
    const oid = req.params.id;
    testAppDb.get(`SELECT ro.*, v.plate_number, v.brand_model, v.owner_name, v.phone, v.mileage,
            t.name as technician_name, t.hourly_rate
            FROM repair_orders ro
            LEFT JOIN vehicles v ON ro.vehicle_id = v.id
            LEFT JOIN technicians t ON ro.technician_id = t.id
            WHERE ro.id = ?`, [oid], (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: '工单不存在' });
      testAppDb.all('SELECT * FROM repair_items WHERE order_id = ?', [oid], (err, items) => {
        if (err) return res.status(500).json({ error: err.message });
        testAppDb.all(`SELECT op.*, p.name as part_name, p.sku, p.stock
                FROM order_parts op LEFT JOIN parts p ON op.part_id = p.id
                WHERE op.order_id = ?`, [oid], (err, parts) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ ...order, items, parts });
        });
      });
    });
  });

  app.post('/api/repair-orders', (req, res) => {
    const { vehicle_id, fault_description, receive_time, expected_delivery, technician_id, items, _test_order_no } = req.body;
    const orderNo = _test_order_no || generateOrderNo();
    let laborFee = 0;
    (items || []).forEach(it => laborFee += (it.labor_fee || 0));
    
    testAppDb.run('BEGIN TRANSACTION');
    testAppDb.run(`INSERT INTO repair_orders (order_no, vehicle_id, fault_description, receive_time, expected_delivery, technician_id, labor_fee, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_diagnosis')`,
      [orderNo, vehicle_id, fault_description, receive_time, expected_delivery, technician_id, laborFee],
      function(err) {
        if (err) { testAppDb.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
        const oid = this.lastID;
        const stmt = testAppDb.prepare('INSERT INTO repair_items (order_id, item_name, labor_hours, labor_fee, description) VALUES (?, ?, ?, ?, ?)');
        (items || []).forEach(it => stmt.run([oid, it.item_name, it.labor_hours || 0, it.labor_fee || 0, it.description || '']));
        stmt.finalize();
        testAppDb.run('COMMIT');
        res.json({ id: oid, order_no: orderNo });
      }
    );
  });

  app.put('/api/repair-orders/:id/status', (req, res) => {
    const { status } = req.body;
    const oid = req.params.id;
    testAppDb.get('SELECT status FROM repair_orders WHERE id = ?', [oid], (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: '工单不存在' });
      if (order.status === 'completed' && (status === 'pending_settlement' || status === 'in_repair' || status === 'pending_diagnosis')) {
        return res.status(400).json({ error: '已完成工单禁止回退为待结算/维修中/待诊断状态。如需调整金额，请通过「结算调整单」办理。' });
      }
      if (order.status === 'completed' && status === 'completed') {
        return res.json({ changes: 0, message: '状态未变化' });
      }
      testAppDb.run('UPDATE repair_orders SET status = ? WHERE id = ?', [status, oid], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ changes: this.changes });
      });
    });
  });

  app.post('/api/repair-orders/:id/add-part', (req, res) => {
    const { part_id, quantity } = req.body;
    const oid = req.params.id;
    testAppDb.get('SELECT sell_price, stock FROM parts WHERE id = ?', [part_id], (err, part) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!part) return res.status(404).json({ error: '配件不存在' });
      const subtotal = part.sell_price * quantity;
      testAppDb.run('INSERT INTO order_parts (order_id, part_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)',
        [oid, part_id, quantity, part.sell_price, subtotal],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: this.lastID, subtotal });
        }
      );
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
    testAppDb.all(sql, params, (err, rows) => {
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
    const curMileage = parseInt(current_mileage);
    if (isNaN(curMileage) || curMileage < 0) {
      return res.status(400).json({ error: '请输入有效的里程数' });
    }
    testAppDb.get(`SELECT mp.*, v.mileage as vehicle_mileage, v.plate_number
            FROM maintenance_plans mp LEFT JOIN vehicles v ON mp.vehicle_id = v.id
            WHERE mp.id = ?`, [mid], (err, plan) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!plan) return res.status(404).json({ error: '保养计划不存在' });
      if (curMileage < plan.vehicle_mileage) {
        return res.status(400).json({
          error: `填写里程（${curMileage.toLocaleString()} km）低于车辆当前里程（${plan.vehicle_mileage.toLocaleString()} km），请确认后重新填写`,
          vehicle_mileage: plan.vehicle_mileage
        });
      }
      const today = new Date().toISOString().split('T')[0];
      const nextMil = curMileage + (plan.interval_mileage || 0);
      const nextDate = new Date(new Date(today).getTime() + (plan.interval_days || 0) * 86400000).toISOString().split('T')[0];
      testAppDb.run(`UPDATE maintenance_plans SET last_mileage=?, last_date=?, next_mileage=?, next_date=?, status='normal' WHERE id=?`,
        [curMileage, today, nextMil, nextDate, mid],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          testAppDb.run('UPDATE vehicles SET mileage = MAX(mileage, ?) WHERE id = ?', [curMileage, plan.vehicle_id], function(verr) {
            if (verr) console.warn('同步车辆里程失败:', verr.message);
          });
          res.json({ ok: true, next_mileage: nextMil, next_date: nextDate });
        }
      );
    });
  });

  app.post('/api/settlements', (req, res) => {
    const { order_id, discount } = req.body;
    const oid = order_id;

    testAppDb.get(`SELECT ro.labor_fee, ro.status, s.id as settlement_id, s.is_locked, s.debt_status
            FROM repair_orders ro
            LEFT JOIN settlements s ON s.order_id = ro.id
            WHERE ro.id = ?`, [oid], (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: '工单不存在' });
      if (order.status !== 'pending_settlement' && order.status !== 'completed') {
        return res.status(400).json({ error: '工单状态不允许结算' });
      }
      if (order.settlement_id && order.is_locked) {
        return res.status(400).json({ error: '结算单已锁定，禁止重复生成或修改。如需调整金额，请通过「结算调整单」办理。', locked: true });
      }
      if (order.debt_status === 'paid' || order.status === 'completed') {
        return res.status(400).json({ error: '工单已完成/已结清，结算单已锁定，禁止重新生成。如需调整金额，请通过「结算调整单」办理。', locked: true });
      }
      testAppDb.all(`SELECT op.part_id, op.quantity, p.stock FROM order_parts op LEFT JOIN parts p ON op.part_id = p.id WHERE op.order_id = ?`, [oid], (err, orderParts) => {
        if (err) return res.status(500).json({ error: err.message });
        const insufficient = orderParts.filter(op => op.stock < op.quantity);
        if (insufficient.length > 0) {
          testAppDb.all(`SELECT p.*, op.quantity as required, (op.quantity - p.stock) as shortage
                  FROM order_parts op LEFT JOIN parts p ON op.part_id = p.id
                  WHERE op.order_id = ? AND p.stock < op.quantity`, [oid], (err, shortageParts) => {
            return res.status(400).json({ error: '库存不足，无法结算', shortage_parts: shortageParts, suggestion: '建议及时采购以上缺件' });
          });
          return;
        }
        testAppDb.get(`SELECT COALESCE(SUM(subtotal), 0) as parts_total FROM order_parts WHERE order_id = ?`, [oid], (err, partsRow) => {
          if (err) return res.status(500).json({ error: err.message });
          const partsTotal = partsRow.parts_total;
          const laborTotal = order.labor_fee;
          const disc = discount || 0;
          const receivable = laborTotal + partsTotal - disc;
          if (order.settlement_id) {
            testAppDb.run(`UPDATE settlements SET labor_total=?, parts_total=?, discount=?, receivable_amount=?,
                    original_receivable=?
                    WHERE id=? AND is_locked=0`,
              [laborTotal, partsTotal, disc, receivable, receivable, order.settlement_id],
              function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) {
                  return res.status(400).json({ error: '结算单已锁定，禁止修改。如需调整金额，请通过「结算调整单」办理。', locked: true });
                }
                res.json({ order_id: oid, labor_total: laborTotal, parts_total: partsTotal, discount: disc, receivable_amount: receivable, updated: true });
              }
            );
          } else {
            testAppDb.run(`INSERT INTO settlements (order_id, labor_total, parts_total, discount, receivable_amount, original_receivable, paid_amount, debt_status, is_locked)
                    VALUES (?, ?, ?, ?, ?, ?, 0, 'unpaid', 0)`,
              [oid, laborTotal, partsTotal, disc, receivable, receivable],
              function(err) {
                if (err) return res.status(500).json({ error: err.message });
                testAppDb.run('UPDATE repair_orders SET status = ? WHERE id = ? AND status != ?', ['pending_settlement', oid, 'completed']);
                res.json({ order_id: oid, labor_total: laborTotal, parts_total: partsTotal, discount: disc, receivable_amount: receivable, created: true });
              }
            );
          }
        });
      });
    });
  });

  app.get('/api/settlements/:orderId', (req, res) => {
    testAppDb.get(`SELECT s.*, ro.order_no, v.plate_number, v.owner_name, v.phone, ro.status as order_status
            FROM settlements s
            LEFT JOIN repair_orders ro ON s.order_id = ro.id
            LEFT JOIN vehicles v ON ro.vehicle_id = v.id
            WHERE s.order_id = ?`, [req.params.orderId], (err, settle) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!settle) return res.status(404).json({ error: '结算单不存在' });
      testAppDb.all('SELECT * FROM payment_records WHERE settlement_id = ? ORDER BY payment_time DESC', [settle.id], (err, payments) => {
        if (err) return res.status(500).json({ error: err.message });
        testAppDb.all(`SELECT sa.* FROM settlement_adjustments sa WHERE sa.settlement_id = ? ORDER BY sa.created_at DESC`, [settle.id], (err, adjustments) => {
          if (err) return res.status(500).json({ error: err.message });
          testAppDb.all(`SELECT idr.*, p.name as part_name, p.sku
                  FROM inventory_deduction_records idr
                  LEFT JOIN parts p ON idr.part_id = p.id
                  WHERE idr.settlement_id = ?
                  ORDER BY idr.created_at DESC`, [settle.id], (err, deductionRecords) => {
            if (err) return res.status(500).json({ error: err.message });
            testAppDb.get('SELECT * FROM reviews WHERE order_id = ?', [req.params.orderId], (err, review) => {
              const originalReceivable = settle.original_receivable || settle.receivable_amount;
              const totalAdjustment = (adjustments || []).reduce((sum, a) => sum + (a.adjustment_amount || 0), 0);
              res.json({
                ...settle,
                original_receivable: originalReceivable,
                total_adjustment: totalAdjustment,
                payments,
                adjustments,
                deduction_records: deductionRecords,
                review
              });
            });
          });
        });
      });
    });
  });

  app.post('/api/settlements/:orderId/pay', (req, res) => {
    const { amount, payment_method, remark, idempotency_key } = req.body;
    const payAmount = parseFloat(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ error: '请输入有效收款金额' });
    }
    const idempKey = idempotency_key || `pay_${req.params.orderId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    testAppDb.get('SELECT * FROM settlements WHERE order_id = ?', [req.params.orderId], (err, settle) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!settle) return res.status(404).json({ error: '结算单不存在' });

      testAppDb.get('SELECT * FROM payment_records WHERE idempotency_key = ?', [idempKey], (err, existingPay) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existingPay) {
          return res.json({
            ok: true,
            idempotent: true,
            payment_id: existingPay.id,
            paid_amount: settle.paid_amount,
            debt_status: settle.debt_status,
            message: '幂等命中，该收款已处理'
          });
        }

        if (settle.debt_status === 'paid') {
          return res.status(400).json({ error: '该工单已全部结清，不可继续收款' });
        }
        const unpaid = (settle.receivable_amount || 0) - (settle.paid_amount || 0);
        if (payAmount > unpaid + 0.01) {
          return res.status(400).json({ error: `收款金额超出欠款金额（最多可收 ¥${unpaid.toFixed(2)}）` });
        }
        const wasPaid = settle.debt_status === 'paid';
        const newPaid = (settle.paid_amount || 0) + payAmount;
        const debtStatus = newPaid >= settle.receivable_amount - 0.01 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
        const justFullyPaid = !wasPaid && debtStatus === 'paid';

        testAppDb.run('BEGIN TRANSACTION');
        testAppDb.run('INSERT INTO payment_records (settlement_id, amount, payment_method, remark, idempotency_key) VALUES (?, ?, ?, ?, ?)',
          [settle.id, payAmount, payment_method || '现金', remark || '', idempKey],
          function(err) {
            if (err) { testAppDb.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
            const payRecordId = this.lastID;
            const isLocked = justFullyPaid ? 1 : settle.is_locked;
            testAppDb.run('UPDATE settlements SET paid_amount = ?, debt_status = ?, is_locked = ? WHERE id = ?',
              [newPaid, debtStatus, isLocked, settle.id],
              function(err) {
                if (err) { testAppDb.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                if (justFullyPaid) {
                  testAppDb.run('UPDATE repair_orders SET status = ? WHERE id = ? AND status != ?',
                    ['completed', req.params.orderId, 'completed']);

                  testAppDb.all(`SELECT op.part_id, op.quantity, op.unit_price, op.subtotal
                          FROM order_parts op WHERE op.order_id = ?`, [req.params.orderId], (err, ops) => {
                    if (err) { testAppDb.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                    if (ops && ops.length > 0) {
                      let processed = 0;
                      let hadError = false;
                      ops.forEach(op => {
                        const dedupKey = `inv_deduct_${settle.id}_${op.part_id}`;
                        testAppDb.get('SELECT id FROM inventory_deduction_records WHERE idempotency_key = ?', [dedupKey], (derr, existing) => {
                          if (derr) { hadError = true; testAppDb.run('ROLLBACK'); return res.status(500).json({ error: derr.message }); }
                          if (!existing) {
                            testAppDb.run('UPDATE parts SET stock = stock - ? WHERE id = ? AND stock >= ?',
                              [op.quantity, op.part_id, op.quantity],
                              function(uerr) {
                                if (uerr) { hadError = true; testAppDb.run('ROLLBACK'); return res.status(500).json({ error: uerr.message }); }
                                if (this.changes === 0) {
                                  hadError = true;
                                  testAppDb.run('ROLLBACK');
                                  return res.status(400).json({ error: `配件ID ${op.part_id} 库存不足，扣减失败` });
                                }
                                testAppDb.run(`INSERT INTO inventory_deduction_records
                                        (settlement_id, part_id, quantity, unit_price, subtotal, idempotency_key)
                                        VALUES (?, ?, ?, ?, ?, ?)`,
                                  [settle.id, op.part_id, op.quantity, op.unit_price, op.subtotal, dedupKey],
                                  function(ierr) {
                                    if (ierr && !ierr.message.includes('UNIQUE')) {
                                      hadError = true;
                                      testAppDb.run('ROLLBACK');
                                      return res.status(500).json({ error: ierr.message });
                                    }
                                    processed++;
                                    if (processed === ops.length && !hadError) {
                                      testAppDb.run('COMMIT');
                                      res.json({
                                        ok: true,
                                        paid_amount: newPaid,
                                        debt_status: debtStatus,
                                        just_fully_paid: justFullyPaid,
                                        payment_id: payRecordId,
                                        idempotent: false
                                      });
                                    }
                                  }
                                );
                              }
                            );
                          } else {
                            processed++;
                            if (processed === ops.length && !hadError) {
                              testAppDb.run('COMMIT');
                              res.json({
                                ok: true,
                                paid_amount: newPaid,
                                debt_status: debtStatus,
                                just_fully_paid: justFullyPaid,
                                payment_id: payRecordId,
                                idempotent: false
                              });
                            }
                          }
                        });
                      });
                    } else {
                      testAppDb.run('COMMIT');
                      res.json({
                        ok: true,
                        paid_amount: newPaid,
                        debt_status: debtStatus,
                        just_fully_paid: justFullyPaid,
                        payment_id: payRecordId,
                        idempotent: false
                      });
                    }
                  });
                } else {
                  testAppDb.run('COMMIT');
                  res.json({
                    ok: true,
                    paid_amount: newPaid,
                    debt_status: debtStatus,
                    just_fully_paid: justFullyPaid,
                    payment_id: payRecordId,
                    idempotent: false
                  });
                }
              }
            );
          }
        );
      });
    });
  });

  app.post('/api/settlements/:orderId/adjust', (req, res) => {
    const { adjustment_amount, adjustment_type, reason, operator, idempotency_key } = req.body;
    const adjAmount = parseFloat(adjustment_amount);
    if (isNaN(adjAmount) || adjAmount === 0) {
      return res.status(400).json({ error: '请输入有效的调整金额（不能为0）' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: '请填写调整原因' });
    }
    if (!operator || !operator.trim()) {
      return res.status(400).json({ error: '请填写操作人' });
    }

    testAppDb.get('SELECT * FROM settlements WHERE order_id = ?', [req.params.orderId], (err, settle) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!settle) return res.status(404).json({ error: '结算单不存在' });

      const idempKey = idempotency_key || `adjust_${settle.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      testAppDb.get('SELECT * FROM settlement_adjustments WHERE idempotency_key = ?', [idempKey], (err, existingAdj) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existingAdj) {
          return res.json({
            ok: true,
            idempotent: true,
            adjustment_id: existingAdj.id,
            message: '幂等命中，该调整单已处理'
          });
        }

        testAppDb.run('BEGIN TRANSACTION');
        testAppDb.run(`INSERT INTO settlement_adjustments
                (settlement_id, adjustment_amount, adjustment_type, reason, operator, idempotency_key)
                VALUES (?, ?, ?, ?, ?, ?)`,
          [settle.id, adjAmount, adjustment_type || 'manual', reason.trim(), operator.trim(), idempKey],
          function(err) {
            if (err) { testAppDb.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
            const adjId = this.lastID;
            const newReceivable = (settle.receivable_amount || 0) + adjAmount;
            const newDebtStatus = newReceivable - (settle.paid_amount || 0) <= 0.01
              ? 'paid'
              : ((settle.paid_amount || 0) > 0 ? 'partial' : 'unpaid');

            testAppDb.run('UPDATE settlements SET receivable_amount = ?, debt_status = ?, is_locked = 1 WHERE id = ?',
              [newReceivable, newDebtStatus, settle.id],
              function(err) {
                if (err) { testAppDb.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                testAppDb.run('COMMIT');
                res.json({
                  ok: true,
                  adjustment_id: adjId,
                  idempotent: false,
                  new_receivable: newReceivable,
                  new_debt_status: newDebtStatus,
                  adjustment_amount: adjAmount
                });
              }
            );
          }
        );
      });
    });
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
      testAppDb.get(sql, [month], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || { labor_total: 0, parts_total: 0, discount: 0, total_revenue: 0, order_count: 0 });
      });
      return;
    }
    testAppDb.all(sql, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.get('/api/stats/parts-ranking', (req, res) => {
    testAppDb.all(`SELECT p.id, p.sku, p.name, p.category,
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
    testAppDb.all(`SELECT t.id, t.name, t.specialty,
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
    testAppDb.get(`SELECT COUNT(*) as total,
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
    testAppDb.all(`SELECT v.*, JULIANDAY(insurance_expiry) - JULIANDAY('now') as days_left
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
    testAppDb.all(`SELECT mp.*, v.plate_number, v.brand_model, v.owner_name, v.mileage as current_mileage,
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

  return new Promise((resolve, reject) => {
    testServer = app.listen(TEST_API_PORT, () => {
      console.log(`  [准备] 测试服务器已启动: http://localhost:${TEST_API_PORT}`);
      console.log(`  [准备] 测试数据库: ${TEST_DB_PATH}`);
      resolve();
    });
    testServer.on('error', reject);
  });
}

async function cleanupTestServer() {
  console.log('\n  [清理] 关闭测试服务器...');
  
  if (testServer) {
    await new Promise((resolve) => {
      testServer.close(() => resolve());
    });
    console.log('  [清理] 测试服务器已关闭');
  }
  
  if (testAppDb && testAppDb.open) {
    await new Promise((resolve, reject) => {
      testAppDb.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    testAppDb = null;
    testDb = null;
  }
  
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    console.log('  [清理] 测试数据库已删除');
  }
}

async function createTestData() {
  console.log('  [准备] 创建测试数据...');

  const techRes = await runSql(testAppDb, 
    'INSERT INTO technicians (name, phone, specialty, hourly_rate) VALUES (?, ?, ?, ?)',
    [`${TEST_PREFIX}技师1`, '13800000001', '发动机维修', 150]
  );
  createdTestIds.technicians.push(techRes.lastID);

  const vehicleRes = await runSql(testAppDb,
    'INSERT INTO vehicles (plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`${TEST_PREFIX}001`, `${TEST_PREFIX}丰田凯美瑞`, `${TEST_PREFIX}张三`, '13900000001', 50000, '2023-01-15', `${TEST_PREFIX}VIN001`, '2027-12-31']
  );
  createdTestIds.vehicles.push(vehicleRes.lastID);

  const vehicle2Res = await runSql(testAppDb,
    'INSERT INTO vehicles (plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`${TEST_PREFIX}002`, `${TEST_PREFIX}本田雅阁`, `${TEST_PREFIX}李四`, '13900000002', 30000, '2023-06-20', `${TEST_PREFIX}VIN002`, '2027-06-30']
  );
  createdTestIds.vehicles.push(vehicle2Res.lastID);

  const part1Res = await runSql(testAppDb,
    'INSERT INTO parts (sku, name, category, stock, cost_price, sell_price, compatible_models) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [`${TEST_PREFIX}P001`, `${TEST_PREFIX}全合成机油`, '机油', 100, 180, 280, '通用']
  );
  createdTestIds.parts.push(part1Res.lastID);

  const part2Res = await runSql(testAppDb,
    'INSERT INTO parts (sku, name, category, stock, cost_price, sell_price, compatible_models) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [`${TEST_PREFIX}P002`, `${TEST_PREFIX}机油滤清器`, '滤清器', 200, 25, 50, '通用']
  );
  createdTestIds.parts.push(part2Res.lastID);

  const part3Res = await runSql(testAppDb,
    'INSERT INTO parts (sku, name, category, stock, cost_price, sell_price, compatible_models) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [`${TEST_PREFIX}P003`, `${TEST_PREFIX}空气滤清器`, '滤清器', 150, 35, 70, '通用']
  );
  createdTestIds.parts.push(part3Res.lastID);

  const planRes = await runSql(testAppDb,
    'INSERT INTO maintenance_plans (vehicle_id, item_name, last_mileage, last_date, interval_mileage, interval_days, next_mileage, next_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [vehicle2Res.lastID, `${TEST_PREFIX}机油更换`, 20000, '2025-12-01', 10000, 180, 30000, '2026-06-01', 'normal']
  );
  createdTestIds.maintenancePlans.push(planRes.lastID);

  console.log('  [准备] 测试数据创建完成');
  return {
    techId: techRes.lastID,
    vehicleId: vehicleRes.lastID,
    vehicle2Id: vehicle2Res.lastID,
    part1Id: part1Res.lastID,
    part2Id: part2Res.lastID,
    part3Id: part3Res.lastID,
    planId: planRes.lastID
  };
}

let testOrderCounter = 0;

async function createTestRepairOrder(testData, status = 'pending_diagnosis') {
  testOrderCounter++;
  const customOrderNo = `${TEST_PREFIX}WO${Date.now()}_${testOrderCounter}_${Math.random().toString(36).substr(2, 6)}`;
  const res = await apiRequest('/repair-orders', 'POST', {
    vehicle_id: testData.vehicleId,
    fault_description: `${TEST_PREFIX}发动机异响`,
    receive_time: '2026-06-20 09:00',
    expected_delivery: '2026-06-21 17:00',
    technician_id: testData.techId,
    items: [
      { item_name: `${TEST_PREFIX}发动机检测`, labor_hours: 2, labor_fee: 300, description: '诊断发动机故障' },
      { item_name: `${TEST_PREFIX}更换机油`, labor_hours: 0.5, labor_fee: 80, description: '更换机油机滤' }
    ],
    _test_order_no: customOrderNo
  });
  
  assert(res.status === 200, `创建工单失败: ${JSON.stringify(res.body)}`);
  createdTestIds.repairOrders.push(res.body.id);
  
  await apiRequest(`/repair-orders/${res.body.id}/add-part`, 'POST', {
    part_id: testData.part1Id,
    quantity: 2
  });
  
  await apiRequest(`/repair-orders/${res.body.id}/add-part`, 'POST', {
    part_id: testData.part2Id,
    quantity: 1
  });
  
  if (status !== 'pending_diagnosis') {
    await apiRequest(`/repair-orders/${res.body.id}/status`, 'PUT', { status });
  }
  
  return res.body.id;
}

async function createSettlementAndPay(testData, orderId, payFull = true) {
  const settleRes = await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 0
  });
  assert(settleRes.status === 200, '生成结算单失败');
  
  const settleDetailBefore = await apiRequest(`/settlements/${orderId}`);
  const unpaid = settleDetailBefore.body.receivable_amount - settleDetailBefore.body.paid_amount;
  
  const payAmount = payFull ? unpaid : Math.min(100, unpaid - 50);
  const idempKey = `${TEST_PREFIX}pay_${orderId}_${Date.now()}`;
  
  const payRes = await apiRequest(`/settlements/${orderId}/pay`, 'POST', {
    amount: payAmount,
    payment_method: '测试',
    remark: `${TEST_PREFIX}测试收款`,
    idempotency_key: idempKey
  });
  
  const settleDetailAfter = await apiRequest(`/settlements/${orderId}`);
  
  return { settleDetail: settleDetailAfter, payRes, payAmount, idempKey };
}

async function runTests() {
  console.log('='.repeat(80));
  console.log('结算与库存业务闭环自动化测试');
  console.log('='.repeat(80));
  console.log();
  
  let testData = null;
  
  try {
    await setupTestServer();
    testData = await createTestData();
  } catch (e) {
    console.error('❌ 测试环境初始化失败:', e.message);
    await cleanupTestServer();
    process.exit(1);
  }
  
  console.log();
  console.log('开始执行测试用例...');
  console.log('-'.repeat(80));
  
  for (const { name, fn } of results) {
    process.stdout.write(`  测试: ${name} ... `);
    try {
      await fn(testData);
      console.log('✅ PASS');
      passed++;
    } catch (e) {
      console.log('❌ FAIL');
      console.log(`     原因: ${e.message}`);
      failed++;
    }
  }
  
  console.log('-'.repeat(80));
  
  await cleanupTestServer();
  
  const duration = ((Date.now() - testStartTime) / 1000).toFixed(2);
  
  console.log();
  console.log('='.repeat(80));
  console.log(`测试结果汇总`);
  console.log('='.repeat(80));
  console.log(`  通过: ${passed} 个`);
  console.log(`  失败: ${failed} 个`);
  console.log(`  总计: ${results.length} 个`);
  console.log(`  耗时: ${duration} 秒`);
  console.log(`  通过率: ${results.length > 0 ? ((passed / results.length) * 100).toFixed(1) : 0}%`);
  console.log('='.repeat(80));
  
  if (failed > 0) {
    process.exit(1);
  }
}

test('1. 结算单生成 - 正常场景', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  
  const res = await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 20
  });
  
  assert(res.status === 200, `状态码应为200，实际为${res.status}`);
  assert(res.body.receivable_amount !== undefined, '应返回应收金额');
  assert(res.body.labor_total > 0, '人工费应大于0');
  assert(res.body.parts_total > 0, '配件费应大于0');
  assert(res.body.created === true || res.body.updated === true, '应返回created或updated标志');
  
  const expectedLabor = 300 + 80;
  const expectedParts = 280 * 2 + 50 * 1;
  const expectedReceivable = expectedLabor + expectedParts - 20;
  
  assertApproxEqual(res.body.labor_total, expectedLabor, 0.01, 
    `人工费计算错误: 期望 ${expectedLabor}, 实际 ${res.body.labor_total}`);
  assertApproxEqual(res.body.parts_total, expectedParts, 0.01,
    `配件费计算错误: 期望 ${expectedParts}, 实际 ${res.body.parts_total}`);
  assertApproxEqual(res.body.receivable_amount, expectedReceivable, 0.01,
    `应收金额计算错误: 期望 ${expectedReceivable}, 实际 ${res.body.receivable_amount}`);
});

test('2. 结算单生成 - 非待结算状态应被拒绝', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'in_repair');
  
  const res = await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 0
  });
  
  assert(res.status === 400, `状态码应为400，实际为${res.status}`);
  assert(res.body.error && res.body.error.includes('状态不允许'), 
    `错误信息应包含"状态不允许"，实际为: ${res.body.error}`);
});

test('3. 已结清工单重复收款拦截', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  await createSettlementAndPay(testData, orderId, true);
  
  const res = await apiRequest(`/settlements/${orderId}/pay`, 'POST', {
    amount: 50,
    payment_method: '现金',
    remark: `${TEST_PREFIX}测试重复收款`
  });
  
  assert(res.status === 400, `已结清后继续收款应被拒绝，状态码${res.status}`);
  assert(res.body.error && (res.body.error.includes('全部结清') || res.body.error.includes('已结清')),
    `错误信息应提示已结清，实际为: ${res.body.error}`);
});

test('4. 超额收款拦截 - 收款金额超过欠款', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  
  const settleRes = await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 0
  });
  assert(settleRes.status === 200, '生成结算单失败');
  
  const detail = await apiRequest(`/settlements/${orderId}`);
  const unpaid = detail.body.receivable_amount - detail.body.paid_amount;
  
  const res = await apiRequest(`/settlements/${orderId}/pay`, 'POST', {
    amount: unpaid + 100,
    payment_method: '现金',
    remark: `${TEST_PREFIX}测试超额收款`
  });
  
  assert(res.status === 400, `超额收款应被拒绝，状态码${res.status}`);
  assert(res.body.error && res.body.error.includes('超出欠款'),
    `错误信息应包含"超出欠款"，实际为: ${res.body.error}`);
});

test('5. 部分付款 - 部分付款后状态应为partial', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  
  const settleRes = await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 0
  });
  assert(settleRes.status === 200, '生成结算单失败');
  
  const detailBefore = await apiRequest(`/settlements/${orderId}`);
  const unpaid = detailBefore.body.receivable_amount - detailBefore.body.paid_amount;
  const partialAmount = Math.min(100, unpaid - 50);
  
  const payRes = await apiRequest(`/settlements/${orderId}/pay`, 'POST', {
    amount: partialAmount,
    payment_method: '微信',
    remark: `${TEST_PREFIX}部分付款测试`,
    idempotency_key: `${TEST_PREFIX}partial_${orderId}_${Date.now()}`
  });
  
  assert(payRes.status === 200, `部分付款应成功，状态码${payRes.status}`);
  assert(payRes.body.debt_status === 'partial', 
    `部分付款后状态应为partial，实际为${payRes.body.debt_status}`);
  assert(payRes.body.just_fully_paid === false, 
    '部分付款时just_fully_paid应为false');
  
  const detailAfter = await apiRequest(`/settlements/${orderId}`);
  assertApproxEqual(detailAfter.body.paid_amount, partialAmount, 0.01,
    `已付金额应等于${partialAmount}，实际为${detailAfter.body.paid_amount}`);
  assert(detailAfter.body.debt_status === 'partial',
    `结算单状态应为partial，实际为${detailAfter.body.debt_status}`);
  assert(detailAfter.body.is_locked === 0,
    '部分付款后结算单不应锁定');
});

test('6. 结清后库存只扣减一次 - 通过幂等键保证', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  
  const part1Before = await getSql(testAppDb, 'SELECT stock FROM parts WHERE id = ?', [testData.part1Id]);
  const part2Before = await getSql(testAppDb, 'SELECT stock FROM parts WHERE id = ?', [testData.part2Id]);
  
  const { settleDetail } = await createSettlementAndPay(testData, orderId, true);
  
  const part1After = await getSql(testAppDb, 'SELECT stock FROM parts WHERE id = ?', [testData.part1Id]);
  const part2After = await getSql(testAppDb, 'SELECT stock FROM parts WHERE id = ?', [testData.part2Id]);
  
  assert(part1Before.stock - part1After.stock === 2, 
    `配件1库存应扣减2，扣减前${part1Before.stock}，扣减后${part1After.stock}`);
  assert(part2Before.stock - part2After.stock === 1,
    `配件2库存应扣减1，扣减前${part2Before.stock}，扣减后${part2After.stock}`);
  
  const deductionRecords = settleDetail.body.deduction_records;
  assert(deductionRecords.length === 2, `应有2条库存扣减记录，实际${deductionRecords.length}`);
  
  for (const dr of deductionRecords) {
    assert(dr.idempotency_key, '每条扣减记录应有幂等键');
    assert(dr.idempotency_key.startsWith('inv_deduct_'), 
      `幂等键格式不正确: ${dr.idempotency_key}`);
  }
  
  const detail = await apiRequest(`/settlements/${orderId}`);
  assert(detail.body.debt_status === 'paid', '结清后状态应为paid');
  assert(detail.body.is_locked === 1, '结清后结算单应锁定');
  
  const part1Final = await getSql(testAppDb, 'SELECT stock FROM parts WHERE id = ?', [testData.part1Id]);
  const part2Final = await getSql(testAppDb, 'SELECT stock FROM parts WHERE id = ?', [testData.part2Id]);
  
  assert(part1Final.stock === part1After.stock, 
    `库存不应再次扣减，之前${part1After.stock}，现在${part1Final.stock}`);
  assert(part2Final.stock === part2After.stock,
    `库存不应再次扣减，之前${part2After.stock}，现在${part2Final.stock}`);
});

test('7. 结算调整单幂等 - 相同幂等键只处理一次', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  
  const settleRes = await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 0
  });
  assert(settleRes.status === 200, '生成结算单失败');
  
  const detailBefore = await apiRequest(`/settlements/${orderId}`);
  const adjustCountBefore = detailBefore.body.adjustments.length;
  const receivableBefore = detailBefore.body.receivable_amount;
  
  const idemKey = `${TEST_PREFIX}adjust_idem_${Date.now()}`;
  
  const res1 = await apiRequest(`/settlements/${orderId}/adjust`, 'POST', {
    adjustment_amount: 50,
    adjustment_type: 'surcharge',
    reason: `${TEST_PREFIX}测试调整`,
    operator: `${TEST_PREFIX}测试员`,
    idempotency_key: idemKey
  });
  
  assert(res1.status === 200, '第一次调整应成功');
  assert(res1.body.idempotent === false, '第一次不应幂等命中');
  
  const detailAfter1 = await apiRequest(`/settlements/${orderId}`);
  assert(detailAfter1.body.adjustments.length === adjustCountBefore + 1,
    `调整记录应增加1条，之前${adjustCountBefore}，现在${detailAfter1.body.adjustments.length}`);
  assertApproxEqual(detailAfter1.body.receivable_amount, receivableBefore + 50, 0.01,
    `应收应增加50，之前${receivableBefore}，现在${detailAfter1.body.receivable_amount}`);
  
  const res2 = await apiRequest(`/settlements/${orderId}/adjust`, 'POST', {
    adjustment_amount: 50,
    adjustment_type: 'surcharge',
    reason: `${TEST_PREFIX}测试调整第二次`,
    operator: `${TEST_PREFIX}测试员`,
    idempotency_key: idemKey
  });
  
  assert(res2.status === 200, '第二次调整应返回200（幂等命中）');
  assert(res2.body.idempotent === true, '第二次应幂等命中');
  
  const detailAfter2 = await apiRequest(`/settlements/${orderId}`);
  assert(detailAfter2.body.adjustments.length === adjustCountBefore + 1,
    `调整记录数不应变化（幂等），应为${adjustCountBefore + 1}，实际${detailAfter2.body.adjustments.length}`);
  assertApproxEqual(detailAfter2.body.receivable_amount, receivableBefore + 50, 0.01,
    `应收金额不应重复增加，应为${receivableBefore + 50}，实际${detailAfter2.body.receivable_amount}`);
});

test('8. 已完成工单禁止回退 - completed → pending_settlement', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  await createSettlementAndPay(testData, orderId, true);
  
  const orderBefore = await apiRequest(`/repair-orders/${orderId}`);
  assert(orderBefore.body.status === 'completed', '测试前置条件：工单应为completed状态');
  
  const res = await apiRequest(`/repair-orders/${orderId}/status`, 'PUT', {
    status: 'pending_settlement'
  });
  
  assert(res.status === 400, `已完成工单回退应被拒绝，状态码${res.status}`);
  assert(res.body.error && res.body.error.includes('禁止回退'),
    `错误信息应包含"禁止回退"，实际为: ${res.body.error}`);
  
  const orderAfter = await apiRequest(`/repair-orders/${orderId}`);
  assert(orderAfter.body.status === 'completed', '工单状态不应变化');
});

test('9. 已完成工单禁止回退 - completed → in_repair', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  await createSettlementAndPay(testData, orderId, true);
  
  const res = await apiRequest(`/repair-orders/${orderId}/status`, 'PUT', {
    status: 'in_repair'
  });
  
  assert(res.status === 400, `已完成工单回退为in_repair应被拒绝，状态码${res.status}`);
  assert(res.body.error && res.body.error.includes('禁止回退'),
    `错误信息应包含"禁止回退"，实际为: ${res.body.error}`);
});

test('10. 已完成工单禁止回退 - completed → pending_diagnosis', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  await createSettlementAndPay(testData, orderId, true);
  
  const res = await apiRequest(`/repair-orders/${orderId}/status`, 'PUT', {
    status: 'pending_diagnosis'
  });
  
  assert(res.status === 400, `已完成工单回退为pending_diagnosis应被拒绝，状态码${res.status}`);
  assert(res.body.error && res.body.error.includes('禁止回退'),
    `错误信息应包含"禁止回退"，实际为: ${res.body.error}`);
});

test('11. 保养完成里程校验 - 负数里程应被拒绝', async (testData) => {
  const res = await apiRequest(`/maintenance-plans/${testData.planId}/complete`, 'POST', {
    current_mileage: -100
  });
  
  assert(res.status === 400, `负数里程应被拒绝，状态码${res.status}`);
  assert(res.body.error && res.body.error.includes('有效的里程数'),
    `错误信息应包含"有效的里程数"，实际为: ${res.body.error}`);
});

test('12. 保养完成里程校验 - 非数字里程应被拒绝', async (testData) => {
  const res = await apiRequest(`/maintenance-plans/${testData.planId}/complete`, 'POST', {
    current_mileage: 'abc'
  });
  
  assert(res.status === 400, `非数字里程应被拒绝，状态码${res.status}`);
  assert(res.body.error && res.body.error.includes('有效的里程数'),
    `错误信息应包含"有效的里程数"，实际为: ${res.body.error}`);
});

test('13. 低于当前里程拒绝 - 保养里程小于车辆里程', async (testData) => {
  const vehicleBefore = await getSql(testAppDb, 'SELECT mileage FROM vehicles WHERE id = ?', [testData.vehicle2Id]);
  const currentMileage = vehicleBefore.mileage;
  
  const res = await apiRequest(`/maintenance-plans/${testData.planId}/complete`, 'POST', {
    current_mileage: currentMileage - 1000
  });
  
  assert(res.status === 400, `低于当前里程应被拒绝，状态码${res.status}`);
  assert(res.body.error && res.body.error.includes('低于车辆当前里程'),
    `错误信息应包含"低于车辆当前里程"，实际为: ${res.body.error}`);
  assert(res.body.vehicle_mileage === currentMileage, 
    `应返回车辆当前里程${currentMileage}，实际返回${res.body.vehicle_mileage}`);
});

test('14. 完成保养后车辆里程同步更新', async (testData) => {
  const vehicleBeforeRes = await apiRequest(`/vehicles/${testData.vehicle2Id}`);
  const oldMileage = vehicleBeforeRes.body.mileage;
  const newMileage = oldMileage + 5000;
  
  const planBefore = await getSql(testAppDb, 
    'SELECT * FROM maintenance_plans WHERE id = ?', [testData.planId]);
  
  const res = await apiRequest(`/maintenance-plans/${testData.planId}/complete`, 'POST', {
    current_mileage: newMileage
  });
  
  assert(res.status === 200, `保养完成应成功，状态码${res.status}`);
  assert(res.body.ok === true, '应返回ok: true');
  assert(res.body.next_mileage === newMileage + (planBefore.interval_mileage || 0),
    '下次保养里程计算错误');
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const vehicleAfterRes = await apiRequest(`/vehicles/${testData.vehicle2Id}`);
  assert(vehicleAfterRes.body.mileage >= newMileage,
    `车辆里程应更新为至少${newMileage}，实际为${vehicleAfterRes.body.mileage}`);
  
  const planAfter = await getSql(testAppDb, 
    'SELECT * FROM maintenance_plans WHERE id = ?', [testData.planId]);
  assert(planAfter.last_mileage === newMileage,
    `保养计划last_mileage应更新为${newMileage}，实际为${planAfter.last_mileage}`);
  assert(planAfter.status === 'normal',
    `保养计划状态应为normal，实际为${planAfter.status}`);
});

test('15. 收款幂等性 - 相同幂等键的收款只处理一次', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  
  const settleRes = await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 0
  });
  assert(settleRes.status === 200, '生成结算单失败');
  
  const detail = await apiRequest(`/settlements/${orderId}`);
  const unpaid = detail.body.receivable_amount - detail.body.paid_amount;
  const payAmount = Math.min(200, unpaid - 100);
  const idemKey = `${TEST_PREFIX}pay_idem_${Date.now()}`;
  
  const res1 = await apiRequest(`/settlements/${orderId}/pay`, 'POST', {
    amount: payAmount,
    payment_method: '测试',
    remark: `${TEST_PREFIX}幂等测试第一次`,
    idempotency_key: idemKey
  });
  
  assert(res1.status === 200, `第一次收款应成功，状态码${res1.status}`);
  assert(res1.body.idempotent === false, '第一次不应幂等命中');
  const paidAfterFirst = res1.body.paid_amount;
  
  const res2 = await apiRequest(`/settlements/${orderId}/pay`, 'POST', {
    amount: payAmount,
    payment_method: '测试',
    remark: `${TEST_PREFIX}幂等测试第二次`,
    idempotency_key: idemKey
  });
  
  assert(res2.status === 200, `第二次收款应返回200（幂等命中），状态码${res2.status}`);
  assert(res2.body.idempotent === true, '第二次应幂等命中');
  
  const detailAfter = await apiRequest(`/settlements/${orderId}`);
  assertApproxEqual(detailAfter.body.paid_amount, paidAfterFirst, 0.01,
    `已收金额不应变化，第一次后${paidAfterFirst}，现在${detailAfter.body.paid_amount}`);
  
  const payRecords = await allSql(testAppDb, 
    'SELECT COUNT(*) as cnt FROM payment_records WHERE idempotency_key = ?', [idemKey]);
  assert(payRecords[0].cnt === 1, `收款记录应只有1条，实际${payRecords[0].cnt}条`);
});

test('16. 车辆档案功能不回归', async () => {
  const res = await apiRequest('/vehicles');
  assert(res.status === 200, '车辆列表应正常返回');
  assert(Array.isArray(res.body) && res.body.length > 0, '车辆数据应存在');
});

test('17. 配件库存功能不回归', async () => {
  const res = await apiRequest('/parts');
  assert(res.status === 200, '配件列表应正常返回');
  assert(Array.isArray(res.body) && res.body.length > 0, '配件数据应存在');
});

test('18. 维修工单功能不回归', async () => {
  const res = await apiRequest('/repair-orders');
  assert(res.status === 200, '工单列表应正常返回');
  assert(Array.isArray(res.body), '工单数据应存在');
});

test('19. 保养计划功能不回归', async () => {
  const res = await apiRequest('/maintenance-plans');
  assert(res.status === 200, '保养计划应正常返回');
  assert(Array.isArray(res.body), '保养计划数据应存在');
});

test('20. 结算流水功能不回归', async () => {
  const orders = await apiRequest('/repair-orders?status=completed');
  if (orders.body.length > 0) {
    const res = await apiRequest(`/settlements/${orders.body[0].id}`);
    assert(res.status === 200, '结算详情应正常返回');
    assert(Array.isArray(res.body.payments), '收款记录应存在');
  }
});

test('21. 评价功能不回归', async () => {
  const orders = await apiRequest('/repair-orders?status=completed');
  if (orders.body.length > 0) {
    const res = await apiRequest(`/settlements/${orders.body[0].id}`);
    assert(res.status === 200, '应能获取结算详情');
  }
});

test('22. 统计报表功能不回归', async () => {
  const results = await Promise.all([
    apiRequest('/stats/monthly-revenue'),
    apiRequest('/stats/parts-ranking'),
    apiRequest('/stats/technician-ranking'),
    apiRequest('/stats/rework-rate'),
    apiRequest('/stats/insurance-expiring'),
    apiRequest('/stats/maintenance-due')
  ]);
  
  results.forEach((r, i) => {
    assert(r.status === 200, `统计接口${i + 1}应正常返回`);
  });
});

test('23. 收款记录完整性验证', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  
  const settleRes = await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 0
  });
  assert(settleRes.status === 200, '生成结算单失败');
  
  const detail = await apiRequest(`/settlements/${orderId}`);
  const unpaid = detail.body.receivable_amount - detail.body.paid_amount;
  
  const pay1Amount = Math.min(100, unpaid / 3);
  const pay2Amount = Math.min(150, unpaid / 3);
  
  await apiRequest(`/settlements/${orderId}/pay`, 'POST', {
    amount: pay1Amount,
    payment_method: '微信',
    remark: `${TEST_PREFIX}第一笔付款`,
    idempotency_key: `${TEST_PREFIX}multi_1_${orderId}`
  });
  
  await apiRequest(`/settlements/${orderId}/pay`, 'POST', {
    amount: pay2Amount,
    payment_method: '支付宝',
    remark: `${TEST_PREFIX}第二笔付款`,
    idempotency_key: `${TEST_PREFIX}multi_2_${orderId}`
  });
  
  const detailAfter = await apiRequest(`/settlements/${orderId}`);
  const payments = detailAfter.body.payments;
  
  assert(payments.length >= 2, `应至少有2条收款记录，实际${payments.length}`);
  
  let totalPaid = 0;
  payments.forEach(p => { totalPaid += p.amount; });
  
  assertApproxEqual(totalPaid, detailAfter.body.paid_amount, 0.01,
    `收款流水总和应等于已收金额，流水和=${totalPaid}，已收=${detailAfter.body.paid_amount}`);
});

test('24. 结算调整单字段完整性', async (testData) => {
  const orderId = await createTestRepairOrder(testData, 'pending_settlement');
  
  await apiRequest('/settlements', 'POST', {
    order_id: orderId,
    discount: 0
  });
  
  const adjustRes = await apiRequest(`/settlements/${orderId}/adjust`, 'POST', {
    adjustment_amount: -30,
    adjustment_type: 'discount',
    reason: `${TEST_PREFIX}老客户优惠`,
    operator: `${TEST_PREFIX}张经理`,
    idempotency_key: `${TEST_PREFIX}adjust_fields_${Date.now()}`
  });
  
  assert(adjustRes.status === 200, '调整应成功');
  
  const detail = await apiRequest(`/settlements/${orderId}`);
  const adjustments = detail.body.adjustments;
  
  assert(adjustments.length > 0, '应有调整记录');
  
  const lastAdjust = adjustments[0];
  assert(lastAdjust.adjustment_amount !== undefined && lastAdjust.adjustment_amount !== 0, 
    '调整金额不应为0');
  assert(lastAdjust.reason && lastAdjust.reason.length > 0, '应有调整原因');
  assert(lastAdjust.operator && lastAdjust.operator.length > 0, '应有操作人');
  assert(lastAdjust.created_at && lastAdjust.created_at.length > 0, '应有创建时间');
  assert(lastAdjust.adjustment_type && lastAdjust.adjustment_type.length > 0, '应有调整类型');
});

test('25. 原始数据库未被污染 - 验证数据隔离', async () => {
  const originalDb = new sqlite3.Database(ORIGINAL_DB_PATH);
  
  try {
    const vehicleCount = await getSql(originalDb, 
      `SELECT COUNT(*) as cnt FROM vehicles WHERE plate_number LIKE '${TEST_PREFIX}%'`);
    assert(vehicleCount.cnt === 0, 
      `原始数据库不应包含测试车辆数据，发现${vehicleCount.cnt}条`);
    
    const partCount = await getSql(originalDb, 
      `SELECT COUNT(*) as cnt FROM parts WHERE sku LIKE '${TEST_PREFIX}%'`);
    assert(partCount.cnt === 0, 
      `原始数据库不应包含测试配件数据，发现${partCount.cnt}条`);
    
    const techCount = await getSql(originalDb, 
      `SELECT COUNT(*) as cnt FROM technicians WHERE name LIKE '${TEST_PREFIX}%'`);
    assert(techCount.cnt === 0, 
      `原始数据库不应包含测试技师数据，发现${techCount.cnt}条`);
  } finally {
    originalDb.close();
  }
});

runTests().catch(e => {
  console.error('\n❌ 测试运行异常:', e);
  cleanupTestServer().then(() => process.exit(1));
});