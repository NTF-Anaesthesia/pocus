// Bedside calculator formulas: node pocus/test/calculator.test.cjs
const assert=require('node:assert/strict');
const c=require('../calculator/formulas.js');
const near=(actual,expected,tol=1e-6)=>assert.ok(Math.abs(actual-expected)<tol,`${actual} != ${expected}`);
// FS and Teichholz: the cardiac lecture's machine panel (LVIDd 3.94, LVIDs 2.46 -> FS 37.6%, EF Teich 68.3%)
near(c.fs(3.94,2.46),37.56,.01);
near(c.teichEF(3.94,2.46).ef,68.3,.1);
near(c.teichVolume(5),7*125/7.4);
assert.equal(c.fs(3,4),null);
assert.equal(c.teichEF(3,3),null);
// Quinones: S + (100 − S) × K
near(c.diameterSquaredChange(5,4),36);
near(c.quinones(36,'normal'),36+64*.15);
near(c.quinones(36,'akinetic'),36);
near(c.quinones(36,'aneurysm'),36-6.4);
assert.equal(c.quinones(36,'unknown'),null);
// FAC: the lecture's worked example (22.4 -> 16.2 cm² = 28%)
near(c.fac(22.4,16.2),27.68,.01);
assert.equal(c.fac(10,12),null);
// Volumes and Lang 2015 categories
near(c.volumes(120,50).ef,700/12);
near(c.volumes(120,50).sv,70);
assert.equal(c.efCategory(53,'m'),'Normal');
assert.equal(c.efCategory(53,'f'),'Mildly abnormal');
assert.equal(c.efCategory(40,'m'),'Moderately abnormal');
assert.equal(c.efCategory(29,'f'),'Severely abnormal');
assert.equal(c.efCategory(75,'m'),'Above the normal range');
// Flow: same numbers as haemodynamics/model.js
near(c.flow(2,20,80).area,Math.PI);
near(c.flow(2,20,80).sv,Math.PI*20);
near(c.flow(2,20,80).co,Math.PI*1.6);
assert.equal(c.flow(0,20,80),null);
near(c.bsa(180,80),Math.sqrt(4));
near(c.change(15,17),40/3);
// IVC: same indices as haemodynamics/model.js; a fully collapsed IVC has no distensibility
near(c.ivc(2,1).collapse,50);
near(c.ivc(2,1).distend,100);
near(c.ivc(2,1).variability,200/3);
assert.equal(c.ivc(1,2),null);
assert.equal(c.ivc(2,0).collapse,100);
assert.equal(c.ivc(2,0).distend,null);
// ASE RA pressure
assert.equal(c.rap(1.8,60).value,3);
assert.equal(c.rap(2.4,30).value,15);
assert.equal(c.rap(2.4,60).value,8);
assert.equal(c.rap(1.8,40).value,8);
assert.equal(c.rap(2.1,50).value,8);
console.log('calculator formulas: pass');
