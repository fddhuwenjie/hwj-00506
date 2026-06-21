const API = '/api';
let currentVehicleId = null;
let currentOrderId = null;
let currentPartId = null;
let orderItemsTemp = [];
let currentMaintTab = 'all';
let currentSettleOrderId = null;
let ratingValue = 0;

const STATUS_MAP = {
  pending_diagnosis: '待诊断',
  in_repair: '维修中',
  pending_settlement: '待结算',
  completed: '已完成',
  cancelled: '已取消'
};
const STATUS_CLASS = {
  pending_diagnosis: 'badge-pending-diagnosis',
  in_repair: 'badge-in-repair',
  pending_settlement: 'badge-pending-settlement',
  completed: 'badge-completed',
  cancelled: 'badge-cancelled'
};
const DEBT_CLASS = { paid: 'badge-paid', partial: 'badge-partial', unpaid: 'badge-unpaid' };
const DEBT_MAP = { paid: '已结清', partial: '部分付款', unpaid: '未付款' };

document.getElementById('today').textContent = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
});

document.querySelectorAll('.nav-menu li').forEach(li => {
  li.addEventListener('click', () => {
    document.querySelectorAll('.nav-menu li').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    li.classList.add('active');
    const page = li.dataset.page;
    document.getElementById(page).classList.add('active');
    document.getElementById('pageTitle').textContent = li.querySelector('span:last-child').textContent;
    loadPageData(page);
  });
});

document.getElementById('vehicleSearch').addEventListener('input', debounce(loadVehicles, 300));
document.getElementById('partSearch').addEventListener('input', debounce(loadParts, 300));
document.getElementById('settleSearch').addEventListener('input', debounce(loadSettlements, 300));

function debounce(fn, delay) {
  let t; return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), delay); };
}

function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function openModal(id) { document.getElementById(id).classList.add('active'); }

async function api(url, options = {}) {
  try {
    const res = await fetch(API + url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw data;
    return data;
  } catch (e) {
    if (e && typeof e === 'object' && !e.error) {
      throw { error: '网络请求失败' };
    }
    throw e;
  }
}

function showAlert(msg, type = 'error') {
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = msg;
  const container = document.getElementById('alertContainer');
  container.insertBefore(div, container.firstChild);
  setTimeout(() => div.remove(), 3500);
}

function loadPageData(page) {
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'vehicles': loadVehicles(); break;
    case 'orders': loadOrders(); break;
    case 'maintenance': loadMaintenance(); break;
    case 'parts': loadParts(); break;
    case 'settlements': loadSettlements(); break;
  }
}

async function loadDashboard() {
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const results = await Promise.all([
      api('/stats/monthly-revenue?month=' + month),
      api('/repair-orders'),
      api('/stats/maintenance-due'),
      api('/stats/insurance-expiring?days=30'),
      api('/stats/rework-rate'),
      api('/parts?lowStock=true'),
      api('/stats/parts-ranking'),
      api('/stats/technician-ranking'),
      api('/stats/monthly-revenue')
    ]);
    const [revenue, ordersR, maint, ins, rework, lowStock, ranking, techRanking, revList] = results;

    document.getElementById('stat-revenue').textContent = '¥' + (revenue.total_revenue || 0).toFixed(0);
    document.getElementById('stat-orders').textContent = ordersR.length;
    const inRepair = ordersR.filter(o => o.status === 'in_repair').length;
    document.getElementById('stat-orders-detail').textContent =
      `维修中 ${inRepair} / 待结算 ${ordersR.filter(o => o.status === 'pending_settlement').length}`;
    document.getElementById('stat-maint').textContent = maint.due_count;
    document.getElementById('stat-maint-detail').textContent = `即将到期 ${maint.upcoming_count}`;
    document.getElementById('stat-insurance').textContent = ins.length;
    document.getElementById('stat-rework').textContent = (rework.rework_rate || 0) + '%';
    document.getElementById('stat-lowstock').textContent = lowStock.length;

    let revHtml = '';
    const maxRev = Math.max(...revList.map(r => r.total_revenue || 0), 1);
    revList.slice().reverse().forEach(r => {
      const pct = ((r.total_revenue || 0) / maxRev * 100).toFixed(0);
      revHtml += `<div class="chart-item">
        <div class="chart-label"><span>${r.month}</span><span>¥${(r.total_revenue || 0).toFixed(0)}</span></div>
        <div class="chart-bar"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    });
    document.getElementById('revenue-chart').innerHTML = revHtml || '<div class="empty">暂无数据</div>';

    let rankHtml = '';
    const maxQty = Math.max(...ranking.map(r => r.total_quantity || 0), 1);
    ranking.forEach((r, i) => {
      const pct = ((r.total_quantity || 0) / maxQty * 100).toFixed(0);
      rankHtml += `<div class="chart-item">
        <div class="chart-label"><span>${i + 1}. ${r.name || '-'} (${r.sku || '-'})</span>
          <span>${r.total_quantity || 0}件 / ¥${(r.total_amount || 0).toFixed(0)}</span></div>
        <div class="chart-bar"><div class="chart-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,#38a169,#2f855a)"></div></div>
      </div>`;
    });
    document.getElementById('parts-ranking').innerHTML = rankHtml || '<div class="empty">暂无数据</div>';

    let techHtml = '<table><thead><tr><th>排名</th><th>技师</th><th>专长</th><th>工单数</th><th>总工时</th><th>工时收入</th></tr></thead><tbody>';
    techRanking.forEach((t, i) => {
      techHtml += `<tr>
        <td>${i + 1}</td>
        <td>${t.name}</td>
        <td>${t.specialty || '-'}</td>
        <td>${t.order_count || 0}</td>
        <td>${(t.total_hours || 0).toFixed(1)}h</td>
        <td>¥${(t.total_income || 0).toFixed(2)}</td>
      </tr>`;
    });
    techHtml += '</tbody></table>';
    document.getElementById('tech-ranking').innerHTML = techHtml;

    let insHtml = '<table><thead><tr><th>车牌号</th><th>车主</th><th>品牌车型</th><th>保险到期</th><th>剩余</th></tr></thead><tbody>';
    ins.forEach(v => {
      const dl = Math.floor(v.days_left);
      insHtml += `<tr>
        <td><b>${v.plate_number}</b></td>
        <td>${v.owner_name}</td>
        <td>${v.brand_model}</td>
        <td>${v.insurance_expiry}</td>
        <td><span class="badge badge-due">${dl}天</span></td>
      </tr>`;
    });
    insHtml += '</tbody></table>';
    document.getElementById('insurance-list').innerHTML =
      ins.length ? insHtml : '<div class="empty">暂无即将到期车辆</div>';
  } catch (e) { console.error(e); }
}

async function loadVehicles() {
  try {
    const search = document.getElementById('vehicleSearch').value;
    const url = '/vehicles' + (search ? `?search=${encodeURIComponent(search)}` : '');
    const vehicles = await api(url);
    let html = '';
    vehicles.forEach(v => {
      const insExp = new Date(v.insurance_expiry);
      const daysLeft = Math.ceil((insExp - new Date()) / 86400000);
      const insBadge = daysLeft <= 30 && daysLeft >= 0
        ? `<span class="badge badge-due">${v.insurance_expiry} (剩${daysLeft}天)</span>`
        : daysLeft < 0
          ? `<span class="badge badge-due">${v.insurance_expiry} (已过期${Math.abs(daysLeft)}天)</span>`
          : v.insurance_expiry || '-';
      html += `<tr>
        <td><b>${v.plate_number}</b></td>
        <td>${v.brand_model}</td>
        <td>${v.owner_name}</td>
        <td>${v.phone}</td>
        <td>${(v.mileage || 0).toLocaleString()} km</td>
        <td>${v.purchase_date || '-'}</td>
        <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis">${v.vin || '-'}</td>
        <td>${insBadge}</td>
        <td class="action-bar">
          <button class="btn btn-sm btn-default" onclick="editVehicle(${v.id})">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="deleteVehicle(${v.id})">删除</button>
        </td>
      </tr>`;
    });
    document.getElementById('vehicleList').innerHTML = html ||
      '<tr><td colspan="9" class="empty">暂无车辆数据</td></tr>';
  } catch (e) { console.error(e); }
}

function openVehicleModal(id = null) {
  currentVehicleId = id;
  document.getElementById('vehicleModalTitle').textContent = id ? '编辑车辆' : '新增车辆';
  const fields = ['v_plate', 'v_brand', 'v_owner', 'v_phone', 'v_purchase', 'v_vin', 'v_insurance'];
  fields.forEach(f => document.getElementById(f).value = '');
  document.getElementById('v_mileage').value = 0;
  if (id) {
    api('/vehicles/' + id).then(v => {
      document.getElementById('v_plate').value = v.plate_number;
      document.getElementById('v_brand').value = v.brand_model;
      document.getElementById('v_owner').value = v.owner_name;
      document.getElementById('v_phone').value = v.phone;
      document.getElementById('v_mileage').value = v.mileage || 0;
      document.getElementById('v_purchase').value = v.purchase_date || '';
      document.getElementById('v_vin').value = v.vin || '';
      document.getElementById('v_insurance').value = v.insurance_expiry || '';
    });
  }
  openModal('vehicleModal');
}
function editVehicle(id) { openVehicleModal(id); }

async function saveVehicle() {
  const data = {
    plate_number: document.getElementById('v_plate').value.trim(),
    brand_model: document.getElementById('v_brand').value.trim(),
    owner_name: document.getElementById('v_owner').value.trim(),
    phone: document.getElementById('v_phone').value.trim(),
    mileage: parseInt(document.getElementById('v_mileage').value) || 0,
    purchase_date: document.getElementById('v_purchase').value,
    vin: document.getElementById('v_vin').value.trim(),
    insurance_expiry: document.getElementById('v_insurance').value
  };
  if (!data.plate_number || !data.brand_model || !data.owner_name || !data.phone) {
    return showAlert('请填写必填项（车牌号、品牌型号、车主、电话）');
  }
  try {
    if (currentVehicleId) {
      await api('/vehicles/' + currentVehicleId, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await api('/vehicles', { method: 'POST', body: JSON.stringify(data) });
    }
    closeModal('vehicleModal');
    loadVehicles();
    showAlert(currentVehicleId ? '车辆信息已更新' : '车辆已添加', 'success');
  } catch (e) { showAlert(e.error || '保存失败'); }
}

async function deleteVehicle(id) {
  if (!confirm('确定删除该车辆吗？相关工单和保养记录也会受影响。')) return;
  try {
    await api('/vehicles/' + id, { method: 'DELETE' });
    loadVehicles();
    showAlert('已删除', 'success');
  } catch (e) { showAlert(e.error || '删除失败（可能存在关联记录）'); }
}

async function loadOrders() {
  try {
    const status = document.getElementById('orderStatusFilter').value;
    let url = '/repair-orders';
    if (status) url += `?status=${status}`;
    const orders = await api(url);
    let html = '';
    orders.forEach(o => {
      html += `<tr>
        <td style="font-family:monospace;font-size:12px">${o.order_no}</td>
        <td><b>${o.plate_number}</b></td>
        <td>${o.owner_name}</td>
        <td>${o.brand_model}</td>
        <td>${o.technician_name || '-'}</td>
        <td>${o.receive_time ? o.receive_time.substring(0, 16) : '-'}</td>
        <td>${o.expected_delivery ? o.expected_delivery.substring(0, 10) : '-'}</td>
        <td>¥${(o.labor_fee || 0).toFixed(2)}</td>
        <td><span class="badge ${STATUS_CLASS[o.status]}">${STATUS_MAP[o.status]}</span>${o.is_rework ? ' <span class="badge badge-due">返修</span>' : ''}</td>
        <td class="action-bar">
          <button class="btn btn-sm btn-default" onclick="viewOrder(${o.id})">详情</button>
          ${o.status === 'in_repair' ? `<button class="btn btn-sm btn-warning" onclick="setStatus(${o.id},'pending_settlement')">提交结算</button>` : ''}
          ${o.status === 'pending_settlement' ? `<button class="btn btn-sm btn-success" onclick="goSettle(${o.id})">结算</button>` : ''}
        </td>
      </tr>`;
    });
    document.getElementById('orderList').innerHTML = html ||
      '<tr><td colspan="10" class="empty">暂无工单</td></tr>';
  } catch (e) { console.error(e); }
}

async function openOrderModal() {
  orderItemsTemp = [];
  renderOrderItems();
  try {
    const [vehicles, techs] = await Promise.all([api('/vehicles'), api('/technicians')]);
    document.getElementById('o_vehicle').innerHTML =
      vehicles.map(v => `<option value="${v.id}">${v.plate_number} - ${v.brand_model} (${v.owner_name})</option>`).join('');
    document.getElementById('o_tech').innerHTML =
      '<option value="">请选择</option>' +
      techs.map(t => `<option value="${t.id}">${t.name} (${t.specialty || '综合'}) - ¥${t.hourly_rate}/h</option>`).join('');
    const now = new Date();
    const iso = d => d.toISOString().substring(0, 16);
    document.getElementById('o_receive').value = iso(now);
    const exp = new Date(now.getTime() + 2 * 86400000);
    document.getElementById('o_expected').value = iso(exp);
    document.getElementById('o_fault').value = '';
    document.getElementById('orderModalTitle').textContent = '创建维修单';
    openModal('orderModal');
  } catch (e) { showAlert(e.error || '加载失败'); }
}

function addOrderItem() {
  orderItemsTemp.push({ item_name: '', labor_hours: 0, labor_fee: 0, description: '' });
  renderOrderItems();
}
function removeOrderItem(idx) { orderItemsTemp.splice(idx, 1); renderOrderItems(); }
function updateOrderItem(idx, field, val) {
  orderItemsTemp[idx][field] = (field === 'labor_hours' || field === 'labor_fee')
    ? parseFloat(val) || 0 : val;
}
function renderOrderItems() {
  let html = '';
  orderItemsTemp.forEach((it, i) => {
    html += `<tr>
      <td><input type="text" class="input" value="${it.item_name}" onchange="updateOrderItem(${i},'item_name',this.value)" placeholder="项目名称"></td>
      <td><input type="number" class="input" step="0.5" value="${it.labor_hours}" onchange="updateOrderItem(${i},'labor_hours',this.value)" style="width:80px"></td>
      <td><input type="number" class="input" step="10" value="${it.labor_fee}" onchange="updateOrderItem(${i},'labor_fee',this.value)" style="width:100px"></td>
      <td><input type="text" class="input" value="${it.description}" onchange="updateOrderItem(${i},'description',this.value)" placeholder="可选说明"></td>
      <td><button class="btn btn-sm btn-danger" onclick="removeOrderItem(${i})">删除</button></td>
    </tr>`;
  });
  document.getElementById('orderItemsBody').innerHTML = html ||
    '<tr><td colspan="5" class="empty">暂无项目，点击上方「+ 添加项目」</td></tr>';
}

async function saveOrder() {
  const validItems = orderItemsTemp.filter(i => i.item_name && i.item_name.trim());
  const data = {
    vehicle_id: parseInt(document.getElementById('o_vehicle').value),
    technician_id: parseInt(document.getElementById('o_tech').value) || null,
    fault_description: document.getElementById('o_fault').value.trim(),
    receive_time: document.getElementById('o_receive').value,
    expected_delivery: document.getElementById('o_expected').value,
    items: validItems
  };
  if (!data.vehicle_id || !data.fault_description) {
    return showAlert('请选择车辆并填写故障描述');
  }
  try {
    await api('/repair-orders', { method: 'POST', body: JSON.stringify(data) });
    closeModal('orderModal');
    loadOrders();
    showAlert('工单已创建', 'success');
  } catch (e) { showAlert(e.error || '创建失败'); }
}

async function viewOrder(id) {
  try {
    const order = await api('/repair-orders/' + id);
    currentOrderId = id;
    document.getElementById('detailOrderNo').textContent = order.order_no;
    const badge = document.getElementById('detailStatusBadge');
    badge.textContent = STATUS_MAP[order.status];
    badge.className = 'badge ' + STATUS_CLASS[order.status];
    const partsTotal = (order.parts || []).reduce((s, p) => s + (p.subtotal || 0), 0);
    const laborTotal = order.labor_fee || 0;

    let html = '';
    html += `<div class="detail-section"><h4>📋 基本信息</h4>
      <div class="detail-row">
        <div class="detail-item"><div class="label">车牌号</div><div class="value">${order.plate_number}</div></div>
        <div class="detail-item"><div class="label">品牌车型</div><div class="value">${order.brand_model}</div></div>
        <div class="detail-item"><div class="label">车主</div><div class="value">${order.owner_name} / ${order.phone}</div></div>
        <div class="detail-item"><div class="label">当前里程</div><div class="value">${(order.mileage || 0).toLocaleString()} km</div></div>
        <div class="detail-item"><div class="label">负责技师</div><div class="value">${order.technician_name || '-'}</div></div>
        <div class="detail-item"><div class="label">创建时间</div><div class="value">${order.created_at ? order.created_at.substring(0, 16) : '-'}</div></div>
      </div>
      <div style="margin-top:10px;display:flex;gap:20px">
        <div><b>接车时间：</b>${order.receive_time ? order.receive_time.substring(0, 16) : '-'}</div>
        <div><b>预计交付：</b>${order.expected_delivery ? order.expected_delivery.substring(0, 16) : '-'}</div>
        ${order.is_rework ? '<span class="badge badge-due">返修工单</span>' : ''}
      </div>
      <div style="margin-top:8px;padding:8px 12px;background:#fff;border-radius:4px;border:1px solid #e2e8f0">
        <b>故障描述：</b>${order.fault_description || '-'}</div>
    </div>`;

    html += `<div class="detail-section">
      <div class="flex-between" style="margin-bottom:10px">
        <h4 style="margin:0">🔧 维修项目</h4>
        ${order.status === 'in_repair' ? '<button class="btn btn-sm btn-primary" onclick="addItemToOrder()">+ 追加项目</button>' : ''}
      </div>
      <table><thead><tr><th>项目名称</th><th style="width:100px">工时(h)</th><th style="width:120px">工时费</th><th>说明</th></tr></thead><tbody>`;
    if (order.items && order.items.length > 0) {
      order.items.forEach(it => {
        html += `<tr><td>${it.item_name}</td><td>${it.labor_hours}</td>
          <td>¥${(it.labor_fee || 0).toFixed(2)}</td><td>${it.description || '-'}</td></tr>`;
      });
    } else {
      html += '<tr><td colspan="4" class="empty">暂无维修项目</td></tr>';
    }
    html += `</tbody><tfoot style="background:#fff;font-weight:bold">
      <tr><td>合计</td><td></td><td style="color:#e53e3e">¥${laborTotal.toFixed(2)}</td><td></td></tr>
    </tfoot></table></div>`;

    html += `<div class="detail-section">
      <div class="flex-between" style="margin-bottom:10px">
        <h4 style="margin:0">📦 使用配件</h4>
        ${(order.status === 'pending_diagnosis' || order.status === 'in_repair')
          ? '<button class="btn btn-sm btn-primary" onclick="promptAddPart()">+ 添加配件</button>' : ''}
      </div>
      <table><thead><tr><th>SKU</th><th>配件名</th><th style="width:80px">数量</th><th style="width:100px">单价</th><th style="width:120px">小计</th><th style="width:80px">库存</th><th style="width:80px">操作</th></tr></thead><tbody>`;
    if (order.parts && order.parts.length > 0) {
      order.parts.forEach(p => {
        const low = p.stock < p.quantity;
        html += `<tr><td>${p.sku}</td><td>${p.part_name}</td><td>${p.quantity}</td>
          <td>¥${p.unit_price.toFixed(2)}</td><td>¥${p.subtotal.toFixed(2)}</td>
          <td>${p.stock}${low ? ' <span class="badge badge-low-stock">不足</span>' : ''}</td>
          <td>${(order.status === 'pending_diagnosis' || order.status === 'in_repair')
            ? `<button class="btn btn-sm btn-danger" onclick="removeOrderPart(${p.id})">移除</button>` : '-'}</td></tr>`;
      });
    } else {
      html += '<tr><td colspan="7" class="empty">暂未添加配件</td></tr>';
    }
    html += `</tbody><tfoot style="background:#fff;font-weight:bold">
      <tr><td colspan="4">合计</td><td style="color:#e53e3e">¥${partsTotal.toFixed(2)}</td><td></td><td></td></tr>
    </tfoot></table></div>`;

    html += `<div class="detail-section"><h4>💵 费用汇总</h4>
      <div class="detail-row">
        <div class="detail-item"><div class="label">工时费合计</div><div class="value" style="color:#3182ce">¥${laborTotal.toFixed(2)}</div></div>
        <div class="detail-item"><div class="label">配件费合计</div><div class="value" style="color:#38a169">¥${partsTotal.toFixed(2)}</div></div>
        <div class="detail-item"><div class="label">总计</div><div class="value" style="color:#e53e3e;font-size:22px;font-weight:bold">¥${(laborTotal + partsTotal).toFixed(2)}</div></div>
      </div>
    </div>`;

    html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
      ${order.status === 'pending_diagnosis' ? `<button class="btn btn-warning" onclick="setStatus(${order.id},'in_repair')">▶ 开始维修</button>` : ''}
      ${order.status === 'in_repair' ? `<button class="btn btn-warning" onclick="setStatus(${order.id},'pending_settlement')">📝 提交待结算</button>` : ''}
      ${order.status === 'pending_settlement' ? `<button class="btn btn-success" onclick="goSettle(${order.id})">💰 去结算</button>` : ''}
      ${(order.status === 'pending_diagnosis' || order.status === 'in_repair')
        ? `<button class="btn btn-danger" onclick="setStatus(${order.id},'cancelled')">✕ 取消工单</button>` : ''}
      <button class="btn btn-default" onclick="closeModal('orderDetailModal')">关闭</button>
    </div>`;

    document.getElementById('orderDetailBody').innerHTML = html;
    openModal('orderDetailModal');
  } catch (e) { showAlert(e.error || '加载失败'); }
}

async function setStatus(id, status) {
  if (status === 'cancelled' && !confirm('确定取消该工单吗？此操作不可撤销。')) return;
  if (status === 'pending_settlement' && !confirm('确认提交结算？工单状态将变更为「待结算」')) return;
  try {
    await api(`/repair-orders/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
    showAlert('状态已更新', 'success');
    closeModal('orderDetailModal');
    loadOrders();
  } catch (e) { showAlert(e.error || '操作失败'); }
}

async function addItemToOrder() {
  const name = prompt('请输入维修项目名称（如：更换机油）:');
  if (!name) return;
  const hours = parseFloat(prompt('工时数（小时）:', '1') || '0');
  const fee = parseFloat(prompt('工时费（元）:', '100') || '0');
  try {
    await api(`/repair-orders/${currentOrderId}/add-item`, {
      method: 'POST',
      body: JSON.stringify({ item_name: name, labor_hours: hours, labor_fee: fee })
    });
    viewOrder(currentOrderId);
    showAlert('项目已追加', 'success');
  } catch (e) { showAlert(e.error || '添加失败'); }
}

async function promptAddPart() {
  try {
    const parts = await api('/parts');
    let msg = '可用配件列表（输入配件ID添加）：\n\n';
    parts.slice(0, 30).forEach(p => {
      msg += `ID:${p.id} | SKU:${p.sku} | ${p.name} | 库存:${p.stock} | 售价:¥${p.sell_price}\n`;
    });
    if (parts.length > 30) msg += `\n... 还有 ${parts.length - 30} 个配件，请到配件管理页面查看`;
    const pidStr = prompt(msg, '1');
    if (!pidStr) return;
    const pid = parseInt(pidStr);
    if (isNaN(pid)) return showAlert('请输入有效的配件ID');
    const qtyStr = prompt('请输入数量:', '1');
    if (!qtyStr) return;
    const qty = parseInt(qtyStr);
    if (isNaN(qty) || qty <= 0) return showAlert('请输入有效数量');

    await api(`/repair-orders/${currentOrderId}/add-part`, {
      method: 'POST',
      body: JSON.stringify({ part_id: pid, quantity: qty })
    });
    viewOrder(currentOrderId);
    showAlert('配件已添加', 'success');
  } catch (e) { showAlert(e.error || '添加失败（请检查配件ID是否正确）'); }
}

async function removeOrderPart(pid) {
  if (!confirm('确定移除该配件吗？')) return;
  try {
    await api(`/repair-orders/${currentOrderId}/parts/${pid}`, { method: 'DELETE' });
    viewOrder(currentOrderId);
    showAlert('已移除', 'success');
  } catch (e) { showAlert(e.error || '移除失败'); }
}

function goSettle(oid) {
  closeModal('orderDetailModal');
  const discountStr = prompt('请输入优惠金额（元，无优惠填0）:', '0');
  if (discountStr === null) return;
  const discount = parseFloat(discountStr) || 0;
  api('/settlements', {
    method: 'POST',
    body: JSON.stringify({ order_id: oid, discount })
  }).then(data => {
    openSettleDetail(oid);
    showAlert('结算单已生成', 'success');
    loadOrders();
  }).catch(e => {
    if (e.shortage_parts) {
      let msg = '❌ ' + e.error + '\n\n缺件清单:\n';
      e.shortage_parts.forEach(p => {
        msg += `  • ${p.name} (SKU:${p.sku}) - 需要${p.required}件，库存${p.stock}件，缺${p.shortage}件\n`;
      });
      msg += '\n💡 建议: ' + e.suggestion + '\n\n可到配件管理页面点击「入库」补充库存。';
      alert(msg);
    } else {
      showAlert(e.error || '结算失败');
    }
  });
}

function switchMaintTab(el) {
  document.querySelectorAll('#maintenance .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentMaintTab = el.dataset.tab;
  loadMaintenance();
}

async function loadMaintenance() {
  try {
    const list = await api('/maintenance-plans');
    let filtered = list;
    if (currentMaintTab !== 'all') filtered = list.filter(m => m.status === currentMaintTab);
    let html = '';
    filtered.forEach(m => {
      const milLeft = (m.next_mileage || 0) - (m.current_mileage || 0);
      const daysLeft = Math.ceil((new Date(m.next_date) - new Date()) / 86400000);
      const milDisp = milLeft < 0
        ? `<span style="color:#e53e3e">超${Math.abs(milLeft).toLocaleString()}km</span>`
        : milLeft.toLocaleString() + ' km';
      const dayDisp = daysLeft < 0
        ? `<span style="color:#e53e3e">超${Math.abs(daysLeft)}天</span>`
        : daysLeft + '天';
      const statusText = m.status === 'due' ? '待处理' : m.status === 'upcoming' ? '即将到期' : '正常';
      html += `<tr>
        <td><b>${m.plate_number}</b></td>
        <td>${m.owner_name}</td>
        <td>${m.item_name}</td>
        <td>${(m.last_mileage || 0).toLocaleString()} km</td>
        <td>${(m.next_mileage || 0).toLocaleString()} km</td>
        <td>${m.last_date || '-'}</td>
        <td>${m.next_date || '-'}</td>
        <td>${milDisp} / ${dayDisp}</td>
        <td><span class="badge badge-${m.status}">${statusText}</span></td>
        <td>${m.status === 'due' || m.status === 'upcoming'
          ? `<button class="btn btn-sm btn-success" onclick="completeMaint(${m.id}, ${m.current_mileage || 0})">✔ 完成保养</button>`
          : '-'}</td>
      </tr>`;
    });
    document.getElementById('maintList').innerHTML = html ||
      '<tr><td colspan="10" class="empty">暂无保养记录</td></tr>';
  } catch (e) { console.error(e); }
}

async function completeMaint(id, mileage) {
  const vmile = mileage || 0;
  const curStr = prompt(`请输入完成保养时的车辆里程数 (km)：\n\n⚠️  车辆当前里程：${vmile.toLocaleString()} km\n❗ 填写值不得低于当前里程`, String(vmile));
  if (curStr === null) return;
  const cur = parseInt(curStr);
  if (isNaN(cur)) return showAlert('请输入有效里程数');
  if (cur < vmile) {
    return showAlert(`填写里程（${cur.toLocaleString()} km）低于车辆当前里程（${vmile.toLocaleString()} km），请重新填写`);
  }
  try {
    await api(`/maintenance-plans/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ current_mileage: cur })
    });
    loadMaintenance();
    loadDashboard();
    showAlert(`保养已完成，下次提醒里程：${(cur + 10000).toLocaleString()} km 起`, 'success');
  } catch (e) { showAlert(e.error || '操作失败'); }
}

async function loadParts() {
  try {
    const search = document.getElementById('partSearch').value;
    const low = document.getElementById('lowStockOnly').checked;
    let params = [];
    if (search) params.push('search=' + encodeURIComponent(search));
    if (low) params.push('lowStock=true');
    const url = '/parts' + (params.length ? '?' + params.join('&') : '');
    const parts = await api(url);
    let html = '';
    parts.forEach(p => {
      const lowS = p.stock < 10;
      html += `<tr>
        <td><b>${p.sku}</b></td>
        <td>${p.name}</td>
        <td>${p.category || '-'}</td>
        <td>${p.stock}${lowS ? ' <span class="badge badge-low-stock">库存不足</span>' : ''}</td>
        <td>¥${(p.cost_price || 0).toFixed(2)}</td>
        <td>¥${(p.sell_price || 0).toFixed(2)}</td>
        <td style="font-size:12px">${p.compatible_models || '-'}</td>
        <td class="action-bar">
          <button class="btn btn-sm btn-default" onclick="editPart(${p.id})">编辑</button>
          <button class="btn btn-sm btn-success" onclick="openRestock(${p.id},'${p.name.replace(/'/g, '')}')">入库</button>
          <button class="btn btn-sm btn-danger" onclick="deletePart(${p.id})">删除</button>
        </td>
      </tr>`;
    });
    document.getElementById('partList').innerHTML = html ||
      '<tr><td colspan="8" class="empty">暂无配件数据</td></tr>';
  } catch (e) { console.error(e); }
}

function openPartModal(id = null) {
  currentPartId = id;
  document.getElementById('partModalTitle').textContent = id ? '编辑配件' : '新增配件';
  ['p_sku', 'p_name', 'p_category', 'p_models'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('p_stock').value = 0;
  document.getElementById('p_cost').value = 0;
  document.getElementById('p_price').value = 0;
  if (id) {
    api('/parts/' + id).then(p => {
      document.getElementById('p_sku').value = p.sku;
      document.getElementById('p_name').value = p.name;
      document.getElementById('p_category').value = p.category || '';
      document.getElementById('p_stock').value = p.stock;
      document.getElementById('p_cost').value = p.cost_price;
      document.getElementById('p_price').value = p.sell_price;
      document.getElementById('p_models').value = p.compatible_models || '';
    });
  }
  openModal('partModal');
}
function editPart(id) { openPartModal(id); }

async function savePart() {
  const data = {
    sku: document.getElementById('p_sku').value.trim(),
    name: document.getElementById('p_name').value.trim(),
    category: document.getElementById('p_category').value.trim(),
    stock: parseInt(document.getElementById('p_stock').value) || 0,
    cost_price: parseFloat(document.getElementById('p_cost').value) || 0,
    sell_price: parseFloat(document.getElementById('p_price').value) || 0,
    compatible_models: document.getElementById('p_models').value.trim()
  };
  if (!data.sku || !data.name) return showAlert('请填写必填项（SKU编号和配件名称）');
  try {
    if (currentPartId) {
      await api('/parts/' + currentPartId, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await api('/parts', { method: 'POST', body: JSON.stringify(data) });
    }
    closeModal('partModal');
    loadParts();
    loadDashboard();
    showAlert(currentPartId ? '配件已更新' : '配件已添加', 'success');
  } catch (e) { showAlert(e.error || '保存失败'); }
}

async function deletePart(id) {
  if (!confirm('确定删除该配件吗？')) return;
  try {
    await api('/parts/' + id, { method: 'DELETE' });
    loadParts();
    showAlert('已删除', 'success');
  } catch (e) { showAlert(e.error || '删除失败'); }
}

function openRestock(id, name) {
  currentPartId = id;
  document.getElementById('restockPartName').textContent = name;
  document.getElementById('restockQty').value = 10;
  openModal('restockModal');
}
async function confirmRestock() {
  const qty = parseInt(document.getElementById('restockQty').value);
  if (!qty || qty <= 0) return showAlert('请输入有效数量');
  try {
    await api(`/parts/${currentPartId}/restock`, {
      method: 'PUT',
      body: JSON.stringify({ quantity: qty })
    });
    closeModal('restockModal');
    loadParts();
    loadDashboard();
    showAlert(`成功入库 ${qty} 件`, 'success');
  } catch (e) { showAlert(e.error || '入库失败'); }
}

async function loadSettlements() {
  try {
    const search = document.getElementById('settleSearch').value.toLowerCase();
    const pending = await api('/repair-orders?status=pending_settlement');
    const completed = await api('/repair-orders?status=completed');
    const allOrders = [...pending, ...completed];
    const settleList = [];
    for (const o of allOrders) {
      try {
        const s = await api('/settlements/' + o.id);
        if (s) settleList.push(s);
      } catch (e) { }
    }
    const filtered = settleList.filter(s => {
      if (!search) return true;
      return (s.order_no || '').toLowerCase().includes(search) ||
        (s.plate_number || '').toLowerCase().includes(search) ||
        (s.owner_name || '').toLowerCase().includes(search);
    });
    let html = '';
    filtered.forEach(s => {
      const unpaid = (s.receivable_amount || 0) - (s.paid_amount || 0);
      html += `<tr>
        <td style="font-family:monospace;font-size:12px">${s.order_no}</td>
        <td><b>${s.plate_number}</b></td>
        <td>${s.owner_name}</td>
        <td>¥${(s.labor_total || 0).toFixed(2)}</td>
        <td>¥${(s.parts_total || 0).toFixed(2)}</td>
        <td>-¥${(s.discount || 0).toFixed(2)}</td>
        <td style="color:#e53e3e;font-weight:bold">¥${(s.receivable_amount || 0).toFixed(2)}</td>
        <td style="color:#38a169">¥${(s.paid_amount || 0).toFixed(2)}</td>
        <td style="color:${unpaid > 0 ? '#e53e3e' : '#38a169'};font-weight:500">¥${unpaid.toFixed(2)}</td>
        <td><span class="badge ${DEBT_CLASS[s.debt_status]}">${DEBT_MAP[s.debt_status] || s.debt_status}</span></td>
        <td><button class="btn btn-sm btn-primary" onclick="openSettleDetail(${s.order_id})">详情</button></td>
      </tr>`;
    });
    document.getElementById('settleList').innerHTML = html ||
      '<tr><td colspan="11" class="empty">暂无结算单（前往维修工单页面点击「结算」生成）</td></tr>';
  } catch (e) { console.error(e); }
}

async function openSettleDetail(oid) {
  try {
    currentSettleOrderId = oid;
    ratingValue = 0;
    const s = await api('/settlements/' + oid);
    const unpaid = (s.receivable_amount || 0) - (s.paid_amount || 0);
    document.getElementById('settleModalTitle').textContent =
      `结算单 #${s.order_no} [${s.plate_number}]`;

    let html = '';
    html += `<div class="detail-section"><h4>📋 订单信息</h4>
      <div class="detail-row">
        <div class="detail-item"><div class="label">车牌号</div><div class="value">${s.plate_number}</div></div>
        <div class="detail-item"><div class="label">车主</div><div class="value">${s.owner_name} / ${s.phone}</div></div>
        <div class="detail-item"><div class="label">工单状态</div><div class="value"><span class="badge ${STATUS_CLASS[s.order_status]}">${STATUS_MAP[s.order_status] || s.order_status}</span></div></div>
        <div class="detail-item"><div class="label">欠款状态</div><div class="value"><span class="badge ${DEBT_CLASS[s.debt_status]}">${DEBT_MAP[s.debt_status] || s.debt_status}</span></div></div>
      </div>
    </div>`;

    html += `<div class="detail-section"><h4>💰 费用明细</h4>
      <div class="detail-row">
        <div class="detail-item"><div class="label">工时费</div><div class="value" style="color:#3182ce">¥${(s.labor_total || 0).toFixed(2)}</div></div>
        <div class="detail-item"><div class="label">配件费</div><div class="value" style="color:#38a169">¥${(s.parts_total || 0).toFixed(2)}</div></div>
        <div class="detail-item"><div class="label">优惠</div><div class="value" style="color:#dd6b20">-¥${(s.discount || 0).toFixed(2)}</div></div>
        <div class="detail-item"><div class="label">应收金额</div><div class="value" style="color:#e53e3e;font-size:20px;font-weight:bold">¥${(s.receivable_amount || 0).toFixed(2)}</div></div>
        <div class="detail-item"><div class="label">已收金额</div><div class="value" style="color:#38a169;font-weight:bold">¥${(s.paid_amount || 0).toFixed(2)}</div></div>
        <div class="detail-item"><div class="label">待收金额</div><div class="value" style="color:${unpaid > 0 ? '#e53e3e' : '#38a169'};font-weight:bold">¥${unpaid.toFixed(2)}</div></div>
      </div>
    </div>`;

    html += `<div class="detail-section"><h4>💳 收款记录</h4>`;
    if (s.payments && s.payments.length > 0) {
      html += '<table><thead><tr><th>时间</th><th>金额</th><th>付款方式</th><th>备注</th></tr></thead><tbody>';
      s.payments.forEach(p => {
        html += `<tr><td>${p.payment_time ? p.payment_time.substring(0, 16) : '-'}</td>
          <td style="color:#38a169;font-weight:bold">¥${p.amount.toFixed(2)}</td>
          <td>${p.payment_method || '-'}</td><td>${p.remark || '-'}</td></tr>`;
      });
      html += '</tbody></table>';
    } else {
      html += '<div class="empty">暂无收款记录</div>';
    }
    html += '</div>';

    if (unpaid > 0) {
      html += `<div class="detail-section"><h4>➕ 添加收款 <span style="color:#999;font-weight:normal;font-size:12px">（最多可收 ¥${unpaid.toFixed(2)}）</span></h4>
        <div class="form-row">
          <div class="form-group"><label>收款金额 (元) * (上限 ¥${unpaid.toFixed(2)})</label>
            <input type="number" class="input" id="payAmount" step="0.01" min="0.01" max="${unpaid}" value="${unpaid}"></div>
          <div class="form-group"><label>付款方式</label>
            <select class="input" id="payMethod">
              <option>现金</option><option>微信</option><option>支付宝</option>
              <option>银行卡</option><option>挂账</option>
            </select></div>
        </div>
        <div class="form-group"><label>备注</label><input type="text" class="input" id="payRemark" placeholder="可选"></div>
        <button class="btn btn-success" onclick="submitPayment(${unpaid})">✔ 确认收款</button>
      </div>`;
    } else {
      html += `<div class="detail-section"><h4>➕ 添加收款</h4>
        <div class="alert alert-success">✅ 该工单已全部结清，无需继续收款</div>
      </div>`;
    }

    if (s.order_status === 'completed') {
      html += `<div class="detail-section"><h4>⭐ 车主评价</h4>`;
      if (s.review) {
        const stars = '★★★★★'.substring(0, s.review.rating) + '☆☆☆☆☆'.substring(0, 5 - s.review.rating);
        html += `<div style="padding:12px;background:#fff;border-radius:6px;border:1px solid #e2e8f0">
          <div class="stars" style="font-size:20px">${stars}</div>
          <div style="margin-top:6px;font-size:13px;color:#666">${s.review.comment || '（无文字评价）'}</div>
          <div style="margin-top:4px;font-size:11px;color:#999">${s.review.created_at ? s.review.created_at.substring(0, 16) : ''}</div>
        </div>`;
      } else {
        html += `<div>
          <div class="form-group"><label>服务评分</label>
            <div class="rating-input" id="ratingInput">
              <span data-r="1">★</span><span data-r="2">★</span><span data-r="3">★</span><span data-r="4">★</span><span data-r="5">★</span>
            </div>
          </div>
          <div class="form-group"><label>评价内容</label>
            <textarea id="reviewComment" placeholder="分享您的服务体验..."></textarea></div>
          <button class="btn btn-warning" onclick="submitReview()">✍ 提交评价</button>
        </div>`;
      }
      html += '</div>';
    }

    html += `<div style="margin-top:16px;text-align:right">
      <button class="btn btn-default" onclick="closeModal('settleModal')">关闭</button>
    </div>`;

    document.getElementById('settleBody').innerHTML = html;
    openModal('settleModal');

    setTimeout(() => {
      const ratingSpans = document.querySelectorAll('#ratingInput span');
      if (ratingSpans.length > 0) {
        ratingSpans.forEach(sp => {
          sp.addEventListener('mouseover', () => {
            const r = parseInt(sp.dataset.r);
            ratingSpans.forEach(s2 => {
              s2.classList.toggle('active', parseInt(s2.dataset.r) <= r);
            });
          });
          sp.addEventListener('mouseout', () => {
            ratingSpans.forEach(s2 => {
              s2.classList.toggle('active', parseInt(s2.dataset.r) <= ratingValue);
            });
          });
          sp.addEventListener('click', () => {
            ratingValue = parseInt(sp.dataset.r);
            ratingSpans.forEach(s2 => {
              s2.classList.toggle('active', parseInt(s2.dataset.r) <= ratingValue);
            });
          });
        });
      }
    }, 50);
  } catch (e) { showAlert(e.error || '加载结算单失败'); }
}

async function submitPayment(maxUnpaid) {
  const amount = parseFloat(document.getElementById('payAmount').value);
  const method = document.getElementById('payMethod').value;
  const remark = document.getElementById('payRemark').value;
  if (!amount || amount <= 0) return showAlert('请输入有效金额');
  if (maxUnpaid !== undefined && amount > maxUnpaid + 0.01) {
    return showAlert(`收款金额 ¥${amount.toFixed(2)} 超过欠款 ¥${maxUnpaid.toFixed(2)}`);
  }
  try {
    const result = await api(`/settlements/${currentSettleOrderId}/pay`, {
      method: 'POST',
      body: JSON.stringify({ amount, payment_method: method, remark })
    });
    showAlert(`成功收款 ¥${amount.toFixed(2)}${result.just_fully_paid ? '，工单已全部结清，配件库存已扣减' : ''}`, 'success');
    openSettleDetail(currentSettleOrderId);
    loadSettlements();
    loadOrders();
    loadDashboard();
  } catch (e) { showAlert(e.error || '收款失败'); }
}

async function submitReview() {
  const comment = document.getElementById('reviewComment').value.trim();
  if (!ratingValue) return showAlert('请先选择星级评分（点击星星）');
  try {
    await api('/reviews', {
      method: 'POST',
      body: JSON.stringify({ order_id: currentSettleOrderId, rating: ratingValue, comment })
    });
    showAlert('评价提交成功！感谢您的反馈', 'success');
    openSettleDetail(currentSettleOrderId);
  } catch (e) { showAlert(e.error || '提交失败'); }
}

setTimeout(() => loadPageData('dashboard'), 300);
