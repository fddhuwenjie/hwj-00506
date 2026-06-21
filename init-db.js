const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'repair_shop.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
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

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
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

function pad(n, len = 2) { return n.toString().padStart(len, '0'); }
function genOrderNo(i) {
  const d = new Date(2026, 5, 20 - Math.floor(i/2));
  return `WO${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(9+i%8)}${pad(10+i%40)}${pad(i%60)}${pad(i, 3)}`;
}

async function init() {
  try {
    const techs = [
      ['张伟', '13800000001', '发动机专家', 150],
      ['李明', '13800000002', '电气系统', 140],
      ['王强', '13800000003', '底盘维修', 130],
      ['赵刚', '13800000004', '钣金喷漆', 120],
      ['刘洋', '13800000005', '空调系统', 135],
      ['陈勇', '13800000006', '综合维修', 110]
    ];
    for (const t of techs) {
      await runSql(db, 'INSERT INTO technicians (name, phone, specialty, hourly_rate) VALUES (?, ?, ?, ?)', t);
    }
    console.log('✓ 6名技师已插入');

    const brands = ['丰田 凯美瑞', '本田 雅阁', '大众 帕萨特', '奥迪 A4L', '宝马 3系', '奔驰 C级', '别克 君威', '日产 天籁', '福特 蒙迪欧', '马自达 阿特兹', '现代 索纳塔', '起亚 K5', '雪佛兰 迈锐宝', '雪铁龙 C5', '标致 508', '大众 速腾', '丰田 卡罗拉', '本田 思域', '日产 轩逸', '别克 英朗'];
    const ownerNames = ['周建国', '吴淑芬', '郑海涛', '孙丽娟', '钱宇航', '冯晓燕', '蒋志强', '韩美玲', '朱文博', '秦思琪', '许明辉', '何雅婷', '吕伟杰', '施丽敏', '张海涛', '孔令辉', '曹丽华', '严志鹏', '华春梅', '金鑫'];
    const provinces = ['京', '沪', '粤', '苏', '浙', '鲁', '川', '鄂'];
    const vehicles = [];
    for (let i = 0; i < 20; i++) {
      const plate = `${provinces[i%provinces.length]}${String.fromCharCode(65+i)}${10000+i*777}`;
      const year = 2018 + (i % 7);
      const month = (i % 12) + 1;
      const day = (i % 28) + 1;
      const purchaseDate = `${year}-${pad(month)}-${pad(day)}`;
      const insYear = 2026;
      const insMonth = ((i*2) % 12) + 1;
      const insuranceExpiry = `${insYear}-${pad(insMonth)}-${pad(day)}`;
      const vin = 'LVVDB21B' + 'ABCDEFGHIJ'.substring(i%6, (i%6)+2) + pad(i+1, 4) + pad(20-i, 3) + pad(i*13, 3);
      const mileage = 15000 + i * 4500 + (i * 317) % 8000;
      const phone = '139' + pad(10000000 + i*137 + i*59, 8);
      vehicles.push([plate, brands[i], ownerNames[i], phone, mileage, purchaseDate, vin, insuranceExpiry]);
    }
    for (const v of vehicles) {
      await runSql(db, 'INSERT INTO vehicles (plate_number, brand_model, owner_name, phone, mileage, purchase_date, vin, insurance_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', v);
    }
    console.log('✓ 20辆车已插入');

    const partsData = [
      ['P001', '全合成机油 5W-40', '机油', 50, 180, 280, '通用'],
      ['P002', '半合成机油 10W-40', '机油', 60, 120, 200, '通用'],
      ['P003', '机油滤清器', '滤清器', 80, 25, 50, '丰田/本田/日产'],
      ['P004', '空气滤清器', '滤清器', 70, 35, 70, '大众/奥迪/斯柯达'],
      ['P005', '空调滤清器', '滤清器', 75, 40, 80, '通用'],
      ['P006', '汽油滤清器', '滤清器', 45, 50, 95, '通用'],
      ['P007', '前刹车片', '刹车系统', 40, 180, 350, '丰田/本田/日产'],
      ['P008', '后刹车片', '刹车系统', 45, 160, 320, '丰田/本田/日产'],
      ['P009', '前刹车盘', '刹车系统', 25, 320, 580, '大众/奥迪'],
      ['P010', '后刹车盘', '刹车系统', 28, 280, 520, '大众/奥迪'],
      ['P011', '刹车油 DOT4', '刹车系统', 35, 60, 120, '通用'],
      ['P012', '前轮胎 215/55R17', '轮胎', 20, 450, 780, '通用'],
      ['P013', '后轮胎 215/55R17', '轮胎', 22, 430, 750, '通用'],
      ['P014', '前轮胎 225/45R18', '轮胎', 15, 620, 980, '奥迪/宝马/奔驰'],
      ['P015', '火花塞(4支装)', '点火系统', 30, 160, 320, '丰田/本田'],
      ['P016', '点火线圈', '点火系统', 20, 220, 420, '大众/奥迪'],
      ['P017', '蓄电池 60Ah', '电气系统', 25, 380, 650, '通用'],
      ['P018', '蓄电池 70Ah', '电气系统', 18, 450, 750, '奥迪/宝马/奔驰'],
      ['P019', '发电机皮带', '传动系统', 30, 80, 160, '通用'],
      ['P020', '正时皮带套装', '传动系统', 15, 550, 980, '大众/奥迪'],
      ['P021', '防冻液 -25℃', '冷却系统', 40, 70, 140, '通用'],
      ['P022', '水泵', '冷却系统', 18, 280, 520, '丰田/本田'],
      ['P023', '节温器', '冷却系统', 25, 85, 160, '通用'],
      ['P024', '水箱散热器', '冷却系统', 12, 650, 1100, '通用'],
      ['P025', '自动变速箱油', '变速箱', 30, 150, 280, '通用'],
      ['P026', '手动变速箱油', '变速箱', 35, 90, 180, '通用'],
      ['P027', '变速箱滤芯', '变速箱', 22, 120, 230, '通用'],
      ['P028', '前减震器', '悬挂系统', 15, 420, 750, '大众/奥迪'],
      ['P029', '后减震器', '悬挂系统', 18, 380, 680, '大众/奥迪'],
      ['P030', '下摆臂', '悬挂系统', 20, 260, 480, '丰田/本田'],
      ['P031', '平衡杆球头', '悬挂系统', 30, 70, 130, '通用'],
      ['P032', '方向机球头', '转向系统', 22, 90, 170, '通用'],
      ['P033', '转向助力油', '转向系统', 40, 55, 110, '通用'],
      ['P034', '三元催化器', '排气系统', 8, 1200, 2100, '通用'],
      ['P035', '氧传感器', '电气系统', 25, 180, 350, '通用'],
      ['P036', '前保险杠', '外观件', 10, 650, 1200, '丰田/本田/大众'],
      ['P037', '后保险杠', '外观件', 12, 580, 1050, '丰田/本田/大众'],
      ['P038', '前大灯总成', '外观件', 10, 850, 1500, '通用'],
      ['P039', '后视镜总成', '外观件', 15, 260, 480, '通用'],
      ['P040', '雨刮片(对装)', '外观件', 60, 40, 80, '通用']
    ];
    const partPrices = {};
    for (let i = 0; i < partsData.length; i++) {
      const p = partsData[i];
      await runSql(db, 'INSERT INTO parts (sku, name, category, stock, cost_price, sell_price, compatible_models) VALUES (?, ?, ?, ?, ?, ?, ?)', p);
      partPrices[i+1] = p[5];
    }
    console.log('✓ 40个配件已插入');

    const planItems = [
      ['机油更换', 10000, 180],
      ['机油滤芯更换', 10000, 180],
      ['空气滤芯更换', 20000, 365],
      ['空调滤芯更换', 15000, 180],
      ['火花塞更换', 40000, 730],
      ['变速箱油更换', 60000, 1095],
      ['刹车油更换', 40000, 730],
      ['防冻液更换', 40000, 730],
      ['前刹车片检查', 30000, 365],
      ['轮胎更换', 60000, 1095]
    ];
    const today = new Date();
    for (let v = 1; v <= 20; v++) {
      const vmile = vehicles[v-1][4];
      for (const item of planItems) {
        const lastMil = Math.floor(vmile * 0.6);
        const daysAgo = Math.floor(item[2] * 0.4 + (v*7) % 30);
        const lastDate = new Date(today.getTime() - daysAgo * 86400000);
        const nextMil = lastMil + item[1];
        const nextDate = new Date(lastDate.getTime() + item[2] * 86400000);
        const status = (nextMil < vmile || nextDate < today) ? 'due' : 'normal';
        await runSql(db, 'INSERT INTO maintenance_plans (vehicle_id, item_name, last_mileage, last_date, interval_mileage, interval_days, next_mileage, next_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [v, item[0], lastMil, lastDate.toISOString().split('T')[0], item[1], item[2], nextMil, nextDate.toISOString().split('T')[0], status]);
      }
    }
    console.log('✓ 200条保养计划已插入');

    const statuses = ['pending_diagnosis', 'in_repair', 'pending_settlement', 'completed', 'completed', 'completed', 'cancelled'];
    const faults = [
      '发动机异响，加速无力', '刹车时有异响，制动距离长', '空调不制冷，出风异味',
      '电瓶亏电，启动困难', '仪表盘ABS灯亮', '变速箱换挡顿挫',
      '车辆跑偏，方向盘不正', '排气管冒蓝烟', '水温过高报警',
      '轮胎磨损异常', '前大灯不亮', '雨刮器不工作',
      '车门锁故障', '天窗漏水', '行驶中底盘异响',
      '发动机怠速抖动', '油耗异常增加', '悬挂颠簸严重',
      '转向沉重', '启动马达异响'
    ];
    const itemsList = [
      [['发动机检测与诊断', 2, 300], ['更换火花塞', 1, 150], ['清洗节气门', 1, 120]],
      [['刹车片检查', 0.5, 50], ['更换前刹车片', 2, 260], ['刹车系统排空气', 0.5, 80]],
      [['空调系统检测', 1, 120], ['更换空调滤芯', 0.5, 50], ['空调管路清洗', 1, 150]],
      [['蓄电池检测', 0.5, 50], ['更换蓄电池', 1, 100]],
      [['ABS系统诊断', 1.5, 180], ['更换轮速传感器', 1.5, 200]],
      [['变速箱油更换', 2, 250], ['变速箱滤芯更换', 1, 120]],
      [['四轮定位', 1.5, 180], ['轮胎动平衡', 1, 100]],
      [['发动机大修准备', 3, 450], ['更换气门油封', 4, 600]],
      [['冷却系统检测', 1, 120], ['更换水泵', 3, 400], ['更换防冻液', 1, 80]],
      [['轮胎动平衡', 1, 100], ['四轮定位', 1.5, 180], ['更换轮胎', 2, 200]]
    ];
    const partIdxMap = [3, 5, 7, 15, 17, 21, 25, 1, 4, 6];

    for (let i = 0; i < 25; i++) {
      const orderNo = genOrderNo(i);
      const vid = (i % 20) + 1;
      const tid = (i % 6) + 1;
      const status = statuses[i % statuses.length];
      const daysAgo = 24 - i;
      const recvDate = new Date(today.getTime() - daysAgo * 86400000 - ((i*3) % 5) * 86400000);
      const expDate = new Date(recvDate.getTime() + (2 + (i % 4)) * 86400000);
      const items = itemsList[i % itemsList.length];
      let laborTotal = 0;
      items.forEach(it => laborTotal += it[2]);
      const isRework = (i % 11 === 0) ? 1 : 0;
      const receiveStr = recvDate.toISOString().split('T')[0] + ' ' + pad(9 + i%8) + ':00';
      const expectedStr = expDate.toISOString().split('T')[0] + ' 17:00';

      const orderRes = await runSql(db, 'INSERT INTO repair_orders (order_no, vehicle_id, fault_description, receive_time, expected_delivery, technician_id, labor_fee, status, created_at, is_rework) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [orderNo, vid, faults[i % faults.length], receiveStr, expectedStr, tid, laborTotal, status, recvDate.toISOString(), isRework]);
      const oid = orderRes.lastID;
      for (const it of items) {
        await runSql(db, 'INSERT INTO repair_items (order_id, item_name, labor_hours, labor_fee, description) VALUES (?, ?, ?, ?, ?)',
          [oid, it[0], it[1], it[2], it[0] + '施工']);
      }

      let partsTotal = 0;
      const usedParts = [];
      const numParts = 1 + (i % 3);
      for (let p = 0; p < numParts; p++) {
        const pid = partIdxMap[(i + p) % partIdxMap.length];
        const qty = 1 + (p % 2);
        const price = partPrices[pid] || 100;
        const subtotal = price * qty;
        partsTotal += subtotal;
        usedParts.push({ pid, qty, price, subtotal });
      }

      if (status === 'completed' || status === 'pending_settlement') {
        for (const up of usedParts) {
          await runSql(db, 'INSERT INTO order_parts (order_id, part_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)',
            [oid, up.pid, up.qty, up.price, up.subtotal]);
          if (status === 'completed') {
            await runSql(db, 'UPDATE parts SET stock = stock - ? WHERE id = ?', [up.qty, up.pid]);
          }
        }
        const discount = (i % 3 === 0) ? 50 + i*2 : 0;
        const receivable = laborTotal + partsTotal - discount;
        let paid = 0;
        let debtStatus = 'unpaid';
        if (status === 'completed') {
          paid = (i % 4 === 0) ? Math.floor(receivable * 0.5) : receivable;
          if (paid >= receivable) debtStatus = 'paid';
          else if (paid > 0) debtStatus = 'partial';
        }
        const settleRes = await runSql(db, 'INSERT INTO settlements (order_id, labor_total, parts_total, discount, receivable_amount, paid_amount, debt_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [oid, laborTotal, partsTotal, discount, receivable, paid, debtStatus]);
        const sid = settleRes.lastID;
        if (paid > 0) {
          const payDate = new Date(recvDate.getTime() + 3 * 86400000);
          await runSql(db, 'INSERT INTO payment_records (settlement_id, amount, payment_method, payment_time, remark) VALUES (?, ?, ?, ?, ?)',
            [sid, paid, (i%2===0) ? '微信' : '现金', payDate.toISOString(), '']);
        }
        if (status === 'completed' && i % 3 !== 0) {
          const rating = 3 + (i % 3);
          const comments = ['服务专业，满意！', '维修速度快，值得信赖', '技师技术好，问题解决了', '价格合理，下次还来', '整体不错，推荐'];
          await runSql(db, 'INSERT INTO reviews (order_id, rating, comment, created_at) VALUES (?, ?, ?, ?)',
            [oid, rating, comments[i % comments.length], new Date(recvDate.getTime() + 4 * 86400000).toISOString()]);
        }
      }
    }
    console.log('✓ 25张工单及关联数据已插入');
    console.log('\n✅ 所有数据初始化完成！');

    const counts = await Promise.all([
      allSql(db, 'SELECT COUNT(*) as c FROM technicians'),
      allSql(db, 'SELECT COUNT(*) as c FROM vehicles'),
      allSql(db, 'SELECT COUNT(*) as c FROM parts'),
      allSql(db, 'SELECT COUNT(*) as c FROM maintenance_plans'),
      allSql(db, 'SELECT COUNT(*) as c FROM repair_orders'),
    ]);
    console.log(`\n统计: 技师${counts[0][0].c} 车辆${counts[1][0].c} 配件${counts[2][0].c} 保养计划${counts[3][0].c} 工单${counts[4][0].c}`);

    db.close();
  } catch (e) {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  }
}

init();
