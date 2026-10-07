/* 物理回归测试：node physics.test.mjs
   覆盖三类历史缺陷：
   1) 物品飞出笼子消失（能量泵 / NaN）
   2) 物品悬空不落底
   3) 点击晃动不生效或过于剧烈 */
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { createPhysics, CAGE } from './physics.js';

const DT = 1 / 60;
const phys = createPhysics({ origin: { x: 0, y: 0, z: 0 } });
const { world, cageBody, wrenchBody, tileBody, SPAWN, resetBody } = phys;

const finite = b => [b.position, b.velocity, b.angularVelocity]
  .every(v => [v.x, v.y, v.z].every(Number.isFinite));

const _rel = new CANNON.Vec3(), _inv = new CANNON.Quaternion(), _out = new CANNON.Vec3();
function localOfPoint(worldPoint) {                 // 世界点 → 笼局部
  _rel.copy(worldPoint).vsub(cageBody.position, _rel);
  _inv.copy(cageBody.quaternion).inverse();
  return _inv.vmult(_rel, _out);
}
const localOfBody = b => localOfPoint(b.position);
const radial = v => Math.hypot(v.x, v.z);
const cageTilt = () => {                            // 笼轴与竖直方向的夹角
  const y = cageBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
  return Math.acos(Math.max(-1, Math.min(1, y.y)));
};
const pivotStretch = () => {                        // 到锚点的距离应恒等于摆长（约束完整性）
  const d = cageBody.position.vsub(new CANNON.Vec3(0, CAGE.pivotLocalY, 0));
  return Math.abs(d.length() - CAGE.pivotLocalY);
};

/* 刚体不变量：笼体原点到锚点的距离恒等于摆长（任何摆角下都守恒）——
   摆动时重心画弧 y 必然下降，竖直位置不是不变量 */
const hangGap = () => Math.hypot(
  cageBody.position.x,
  cageBody.position.y - CAGE.pivotLocalY,
  cageBody.position.z
);

/* 阶段 1：静置自转 8s —— 不消失、不 NaN、扳手平贴笼底、能量收敛 */
phys.setSpin(true);
let wrenchMaxSpeed = 0;
for (let i = 0; i < 480; i++) {
  phys.step(DT);
  assert.ok(finite(wrenchBody) && finite(tileBody) && finite(cageBody), `NaN/Inf @ step ${i}`);
  wrenchMaxSpeed = Math.max(wrenchMaxSpeed, wrenchBody.velocity.length());
}
assert.ok(wrenchMaxSpeed < 25, `扳手速度尖峰 ${wrenchMaxSpeed.toFixed(1)}`);

const wLoc = localOfBody(wrenchBody);
assert.ok(radial(wLoc) < 1.35, `扳手跑出笼内区域 r=${radial(wLoc).toFixed(2)}`);
assert.ok(wLoc.y > 0 && wLoc.y < 2.2, `扳手高度异常 y=${wLoc.y.toFixed(2)}`);
const hLoc = localOfPoint(wrenchBody.pointToWorldFrame(new CANNON.Vec3(0.696, 0.088, 0)));
assert.ok(radial(hLoc) < 1.05, `扳手头部越过内壁 r=${radial(hLoc).toFixed(2)}`);
assert.ok(hLoc.y > 0.05 && hLoc.y < 2.3, `头部高度异常 y=${hLoc.y.toFixed(2)}`);
const tLoc = localOfBody(tileBody);
assert.ok(radial(tLoc) < 1.1 && tLoc.y > 0.05 && tLoc.y < 1.3, `幺鸡不在笼底 r=${radial(tLoc).toFixed(2)} y=${tLoc.y.toFixed(2)}`);
assert.ok(wrenchBody.velocity.length() < 2 && tileBody.velocity.length() < 2, '自转下物品未收敛');
assert.ok(cageTilt() < 0.1, '静置时笼子未回正');
assert.ok(Math.abs(hangGap() - CAGE.pivotLocalY) < 0.03, `约束失效：杆长 ${hangGap().toFixed(3)} ≠ ${CAGE.pivotLocalY}`);
console.log('阶段1 通过：静置自转 8s，扳手平贴笼底，笼子悬挂正常');

/* 阶段 2：点击风暴 12s（每秒一次，交替物品）—— 笼子真实摆动且物品不逃逸 */
let maxTilt = 0;
for (let i = 0; i < 720; i++) {
  if (i % 60 === 0) {
    const t = i % 120 === 0 ? 'wrench' : 'tile';
    phys.setActiveItem(t);                  // 切换即换碰撞箱
    phys.shake(t);
  }
  phys.step(DT);
  assert.ok(finite(wrenchBody) && finite(tileBody) && finite(cageBody), `点击风暴 NaN @ ${i}`);
  maxTilt = Math.max(maxTilt, cageTilt());
  if (i % 60 === 59) {
    for (const [name, b] of [['扳手', wrenchBody], ['幺鸡', tileBody]]) {
      if (!world.bodies.includes(b)) continue;   // 未挂载的已存档冻结
      const l = localOfBody(b);
      assert.ok(radial(l) < 1.25 && l.y > -0.3 && l.y < 2.8, `${name} 越过栏杆平面 @${i} r=${radial(l).toFixed(2)}`);
    }
  }
}
assert.ok(maxTilt > 0.03, `点击未让笼子摆动 maxTilt=${maxTilt.toFixed(3)}`);
assert.ok(Math.abs(hangGap() - CAGE.pivotLocalY) < 0.03, `风暴后约束失效：杆长 ${hangGap().toFixed(3)}`);
console.log(`阶段2 通过：点击风暴 12s，笼子最大摆角 ${(maxTilt * 180 / Math.PI).toFixed(1)}°，悬挂正常，物品均在笼内`);

/* 阶段 3：物品切换重置 —— 扳手回到卡位，幺鸡落到笼底 */
phys.setActiveItem('wrench');
resetBody(wrenchBody, SPAWN.wrench);
for (let i = 0; i < 120; i++) phys.step(DT);
const wl = localOfBody(wrenchBody);
const hl = localOfPoint(wrenchBody.pointToWorldFrame(new CANNON.Vec3(0.696, 0.088, 0)));
assert.ok(radial(wl) < 1.5 && radial(wl) < 1.5, `扳手重置后位置异常 r=${radial(wl).toFixed(2)}`);
assert.ok(radial(hl) < 1.05, `重置后头部未卡进栏杆 r=${radial(hl).toFixed(2)}`);
phys.setActiveItem('tile');
resetBody(tileBody, SPAWN.tile);
for (let i = 0; i < 120; i++) phys.step(DT);
const tl = localOfBody(tileBody);
assert.ok(radial(tl) < 1.1 && tl.y > 0.05 && tl.y < 1.2, `幺鸡重置后不在笼底 r=${radial(tl).toFixed(2)} y=${tl.y.toFixed(2)}`);
console.log('阶段3 通过：切换物品后扳手与幺鸡都落回笼底');

/* 阶段 4：30s 高强度折腾（每 0.5s 点击 + 全程自转）——封闭壳不许有任何泄漏 */
phys.setSpin(true);
for (let i = 0; i < 1800; i++) {
  if (i % 30 === 0) {
    const t = i % 60 === 0 ? 'wrench' : 'tile';
    phys.setActiveItem(t);                     // 风暴中反复挂载/摘除，验证切换稳定性
    phys.shake(t);
  }
  phys.step(DT);
  assert.ok(finite(wrenchBody) && finite(tileBody) && finite(cageBody), `NaN/Inf @ soak ${i}`);
  for (const [name, b] of [['扳手', wrenchBody], ['幺鸡', tileBody]]) {
      if (!world.bodies.includes(b)) continue;   // 未挂载的已存档冻结
    const l = localOfBody(b);
    assert.ok(radial(l) < 1.15 && l.y > -0.3 && l.y < 2.8, `${name} 越狱 @${i} r=${radial(l).toFixed(2)} y=${l.y.toFixed(2)}`);
  }
}
console.log('阶段4 通过：30s 高强度折腾，物品始终在笼内');
console.log('physics regression: all pass');
