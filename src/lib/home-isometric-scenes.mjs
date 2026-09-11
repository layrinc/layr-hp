// Original isometric diagrams, each composed for one homepage placement.
// All geometry is deterministic. Colours inherit the site's existing tokens.
const C = {
  white:'var(--paper)', light:'var(--iso-gray-1)', top:'var(--iso-gray-2)',
  side:'var(--iso-gray-3)', edge:'var(--iso-gray-4)', ink:'var(--iso-ink)',
  green:'var(--green)', dark:'var(--green-dark)', pale:'var(--green-pale2)',
};
const pt = (x,y,z=0) => [200 + .82*(x-y), 208 + .42*(x+y)-z];
const coords = (points) => points.map(p=>p.map(n=>Number(n.toFixed(2))).join(',')).join(' ');
const poly = (points,fill) => '<polygon points="'+coords(points)+'" fill="'+fill+'"/>';
const line = (points,colour=C.dark,width=3) => '<polyline points="'+coords(points)+'" fill="none" stroke="'+colour+'" stroke-width="'+width+'" stroke-linecap="round" stroke-linejoin="round"/>';
function box(x,y,z,w,d,h,front=C.white,side=C.side,top=C.light) {
  return poly([pt(x,y+d,z),pt(x+w,y+d,z),pt(x+w,y+d,z+h),pt(x,y+d,z+h)],front)
    + poly([pt(x+w,y,z),pt(x+w,y+d,z),pt(x+w,y+d,z+h),pt(x+w,y,z+h)],side)
    + poly([pt(x,y,z+h),pt(x+w,y,z+h),pt(x+w,y+d,z+h),pt(x,y+d,z+h)],top);
}
const rect = (x,y,w,h,fill,rx=0) => '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+rx+'" fill="'+fill+'"/>';
const circle = (x,y,r,fill) => '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+fill+'"/>';
const path = (d,fill) => '<path d="'+d+'" fill="'+fill+'"/>';
function face(x,y,z,content) {
  const [px,py]=pt(x,y,z);
  return '<g transform="matrix(.82 .42 0 1 '+px.toFixed(2)+' '+py.toFixed(2)+')">'+content+'</g>';
}
function board(x,y,z,w,h,content) {
  return box(x,y,z,w,8,h,C.white,C.edge,C.top)
    + face(x,y+8,z+h,content);
}
const base=box(-92,-70,-8,184,140,8,C.top,C.side,C.light);
const stem=(x,y,h)=>box(x,y,0,6,6,h,C.side,C.edge,C.top);
const check=(x,y,s=1)=>'<g transform="translate('+x+' '+y+') scale('+s+')">'+line([[0,8],[7,15],[22,0]],C.white,4)+'</g>';
const panelHead=(w)=>rect(0,0,w,13,C.green);
function scene(content) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300" aria-hidden="true" focusable="false">'+base+content+'</svg>'; }

export const HOME_SCENES = {
  // Account construction: a rich-menu phone with components ready to assemble.
  build: scene(
    box(-42,-24,8,75,12,157,C.ink,C.edge,C.ink)
    + face(-37,-12,158,rect(0,0,65,142,C.white,4)+rect(22,3,21,4,C.ink,2)
      +circle(14,26,7,C.green)+rect(27,20,28,4,C.side,2)+rect(27,29,20,3,C.top)
      +rect(9,45,47,26,C.pale,3)+rect(9,79,21,22,C.green,2)+rect(35,79,21,22,C.green,2)
      +rect(9,106,21,22,C.pale,2)+rect(35,106,21,22,C.pale,2))
    +box(38,-10,5,30,30,16,C.green,C.dark,C.pale)
    +box(44,26,5,24,24,11,C.white,C.side,C.top)
    +line([pt(40,-8,45),pt(62,-8,45),pt(62,16,45)],C.dark,2)
  ),
  // Ongoing operation: an editorial calendar and a rising measurement chart.
  operate: scene(
    stem(-43,-28,15)+stem(57,-28,15)
    +board(-63,-32,15,134,115,panelHead(134)
      +[0,1,2,3].map(i=>rect(12+i*29,26,20,15,i===2?C.green:C.top,2)).join('')
      +[0,1,2,3].map(i=>rect(12+i*29,49,20,15,i===1?C.pale:C.top,2)).join('')
      +line([[13,98],[37,91],[62,97],[90,78],[119,70]],C.dark,4)
      +circle(119,70,5,C.green))
    +box(-37,32,0,19,21,22,C.pale,C.side,C.white)
    +box(-8,32,0,19,21,36,C.green,C.dark,C.pale)
    +box(21,32,0,19,21,53,C.green,C.dark,C.pale)
  ),
  // Account opening: an identity card and a completed setup mark.
  account: scene(
    board(-48,-24,6,96,137,panelHead(96)+circle(48,43,17,C.pale)
      +circle(48,39,7,C.green)+path('M33 55 Q33 44 48 44 Q63 44 63 55Z',C.green)
      +rect(20,73,56,5,C.side,2)+rect(27,84,42,4,C.top,2)
      +rect(18,105,60,16,C.pale,3))
    +box(43,12,5,27,23,35,C.green,C.dark,C.pale)
    +face(47,35,35,check(0,0,.8))
  ),
  // Scenario design: three connected stages at successive heights.
  scenario: scene(
    line([pt(-62,18,2),pt(-18,18,2),pt(-18,-24,2),pt(38,-24,2)],C.dark,3)
    +box(-77,15,1,37,28,14,C.green,C.dark,C.pale)
    +box(-25,-9,1,37,28,28,C.green,C.dark,C.pale)
    +box(27,-33,1,37,28,42,C.green,C.dark,C.pale)
    +board(-75,14,21,40,42,rect(6,9,27,4,C.green,2)+rect(6,19,22,3,C.side)+rect(6,27,16,3,C.side))
    +board(-23,-10,35,40,42,rect(6,9,27,4,C.green,2)+rect(6,19,22,3,C.side)+rect(6,27,16,3,C.side))
    +board(29,-34,49,40,42,rect(6,9,27,4,C.green,2)+rect(6,19,22,3,C.side)+rect(6,27,16,3,C.side))
  ),
  // Creative production: layered artboards, colour swatches and a cursor.
  creative: scene(
    board(-53,-39,12,109,111,rect(8,10,92,89,C.top,3))
    +board(-70,-12,7,109,111,panelHead(109)+rect(10,24,88,55,C.pale,3)
      +circle(77,39,8,C.white)+path('M10 79L35 47L54 66L70 53L98 79Z',C.green)
      +rect(10,88,24,9,C.dark,2)+rect(42,88,24,9,C.green,2)+rect(74,88,24,9,C.pale,2))
    +face(55,34,56,path('M0 0L0 45L12 33L21 50L29 46L20 29L37 29Z',C.ink))
  ),
  // Advertising: a target and three separate audience nodes.
  campaign: scene(
    stem(-13,-28,26)
    +board(-55,-38,27,100,99,rect(0,0,100,99,C.pale)
      +circle(50,48,35,C.white)+circle(50,48,24,C.green)+circle(50,48,13,C.white)+circle(50,48,5,C.dark)
      +line([[50,48],[81,20]],C.ink,4)+path('M74 18L89 13L84 28Z',C.ink))
    +[-52,-7,38].map(x=>box(x,28,0,24,24,8,C.white,C.side,C.top)
      +face(x+3,51,42,circle(9,7,7,C.green)+path('M0 34V23Q0 14 9 14Q18 14 18 23V34Z',C.dark))).join('')
  ),
  // Industry use cases: one storefront instead of the contract illustration.
  industries: scene(
    box(-53,-28,0,104,67,91,C.white,C.side,C.top)
    +box(-61,-36,91,120,83,9,C.top,C.edge,C.white)
    +face(-53,39,85,rect(8,8,88,19,C.pale)+rect(10,34,36,51,C.green)
      +rect(54,34,36,51,C.pale)+rect(16,41,24,36,C.white)
      +line([[83,60],[83,69]],C.dark,2))
    +box(-61,30,63,120,21,13,C.green,C.dark,C.pale)
    +[0,2,4].map(i=>box(-61+i*24,30,63,12,21,13,C.white,C.side,C.white)).join('')
  ),
  // Client outcome: a trophy, distinct from the sales chart elsewhere.
  client: scene(
    box(-30,-20,0,60,44,14,C.white,C.side,C.top)
    +box(-19,-9,14,38,26,10,C.green,C.dark,C.pale)
    +stem(-3,-1,62)
    +face(-45,3,143,
      path('M10 5H80V40Q80 70 45 79Q10 70 10 40Z',C.green)
      +path('M45 5H80V40Q80 70 45 79Z',C.dark)
      +line([[10,16],[-3,16],[-3,40],[15,55]],C.green,8)
      +line([[80,16],[93,16],[93,40],[75,55]],C.dark,8)
      +path('M45 22L50 34L64 35L54 44L57 57L45 50L33 57L36 44L26 35L40 34Z',C.white))
  ),
  // Social value: a globe distributing useful products.
  society: scene(
    stem(-2,-14,33)
    +face(-46,-6,137,
      circle(46,44,43,C.pale)
      +'<ellipse cx="46" cy="44" rx="20" ry="43" fill="none" stroke="'+C.green+'" stroke-width="3"/>'
      +'<ellipse cx="46" cy="44" rx="43" ry="16" fill="none" stroke="'+C.green+'" stroke-width="3"/>'
      +line([[3,44],[89,44]],C.green,3)+line([[46,1],[46,87]],C.green,3))
    +box(-67,34,0,27,25,22,C.white,C.side,C.top)
    +box(34,34,0,27,25,22,C.green,C.dark,C.pale)
    +line([pt(-34,39,3),pt(0,54,3),pt(28,42,3)],C.dark,2)
  ),
  // LAYR: two interlocking links signify a continuing partnership.
  partnership: scene(
    box(-57,-17,0,48,47,12,C.white,C.side,C.top)
    +box(13,-17,0,48,47,12,C.white,C.side,C.top)
    +face(-54,10,100,
      '<rect x="0" y="0" width="73" height="43" rx="21" fill="none" stroke="'+C.green+'" stroke-width="13" transform="rotate(-25 37 22)"/>'
      +'<rect x="45" y="23" width="73" height="43" rx="21" fill="none" stroke="'+C.dark+'" stroke-width="13" transform="rotate(-25 82 44)"/>')
  ),
  // Contact: an open envelope with a reply card.
  contact: scene(
    board(-46,-24,40,90,89,rect(12,17,64,6,C.green,2)+rect(12,33,53,4,C.side,2)
      +rect(12,46,60,4,C.side,2)+rect(12,59,35,4,C.side,2))
    +box(-62,-1,5,126,8,78,C.green,C.dark,C.pale)
    +face(-62,7,83,
      path('M0 0L63 42L126 0V78H0Z',C.green)
      +path('M0 78L48 36L63 45L78 36L126 78Z',C.pale)
      +line([[0,0],[63,43],[126,0]],C.white,2))
  ),
};
