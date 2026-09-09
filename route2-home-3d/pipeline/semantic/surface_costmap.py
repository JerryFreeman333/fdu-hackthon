"""Conservative surface-derived 2.5D walkability for Route 2 Home Twin."""
from __future__ import annotations

import argparse
import heapq
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

Vec3 = tuple[float, float, float]
HARD_CATEGORIES = {"cable"}
SOFT_COST = {"rug": 3.0, "threshold": 5.0}

@dataclass(frozen=True)
class Plane:
    point: Vec3
    normal: Vec3

@dataclass(frozen=True)
class Basis:
    origin: Vec3
    u: Vec3
    v: Vec3
    n: Vec3
    def project(self, p: Vec3) -> tuple[float, float, float]:
        d = sub(p, self.origin)
        return dot(d, self.u), dot(d, self.v), dot(d, self.n)
    def unproject(self, u: float, v: float, h: float = 0.0) -> Vec3:
        return add(self.origin, add(add(scale(self.u, u), scale(self.v, v)), scale(self.n, h)))

@dataclass
class Grid:
    min_u: float
    min_v: float
    cell: float
    width: int
    height: int
    cost: list[float]
    blocked: list[bool]
    ground: list[bool]
    def index(self, x: int, y: int) -> int:
        return y * self.width + x
    def cell_of(self, u: float, v: float) -> tuple[int, int]:
        return int(math.floor((u - self.min_u) / self.cell)), int(math.floor((v - self.min_v) / self.cell))
    def inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height

def add(a: Vec3, b: Vec3) -> Vec3: return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def sub(a: Vec3, b: Vec3) -> Vec3: return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def scale(a: Vec3, s: float) -> Vec3: return (a[0]*s, a[1]*s, a[2]*s)
def dot(a: Vec3, b: Vec3) -> float: return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def cross(a: Vec3, b: Vec3) -> Vec3: return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a: Vec3) -> float: return math.sqrt(dot(a, a))
def normalize(a: Vec3) -> Vec3:
    n = norm(a)
    if n <= 1e-12: raise ValueError("zero-length vector")
    return scale(a, 1.0/n)

def parse_point3d_line(line: str) -> Vec3 | None:
    parts = line.split()
    if len(parts) < 4 or line.startswith("#"): return None
    try: return float(parts[1]), float(parts[2]), float(parts[3])
    except ValueError: return None

def load_points(path: Path) -> list[Vec3]:
    points = [p for line in path.read_text(encoding="utf-8").splitlines() if (p := parse_point3d_line(line)) is not None]
    if len(points) < 12: raise RuntimeError(f"COLMAP 3D 点过少: {len(points)}，至少需要 12 个点")
    return points

def plane_from_three(a: Vec3, b: Vec3, c: Vec3) -> Plane | None:
    n = cross(sub(b, a), sub(c, a))
    if norm(n) <= 1e-9: return None
    return Plane(a, normalize(n))

def point_plane_distance(p: Vec3, plane: Plane) -> float: return abs(dot(sub(p, plane.point), plane.normal))

def estimate_candidate_ground(points: list[Vec3], threshold: float = 0.02, iterations: int = 500) -> tuple[Plane, list[Vec3], float]:
    """Return dominant planar support. It is only a candidate ground plane because COLMAP lacks gravity."""
    rng, best = random.Random(42), None
    for _ in range(min(iterations, max(1, len(points)*3))):
        plane = plane_from_three(*[points[i] for i in rng.sample(range(len(points)), 3)])
        if plane is None: continue
        ds = [point_plane_distance(p, plane) for p in points]
        inliers = [d for d in ds if d <= threshold]
        if not inliers: continue
        candidate = (len(inliers), -sorted(inliers)[len(inliers)//2], plane)
        if best is None or candidate[:2] > best[:2]: best = candidate
    if best is None: raise RuntimeError("无法估计候选平面")
    count, neg_error, plane = best
    support = count / len(points)
    if support < 0.12: raise RuntimeError(f"候选平面支持率过低: {support:.1%}")
    return plane, [p for p in points if point_plane_distance(p, plane) <= threshold], support

def make_basis(plane: Plane) -> Basis:
    n = normalize(plane.normal)
    ref = (0.0,0.0,1.0) if abs(n[2]) < 0.9 else (1.0,0.0,0.0)
    u = normalize(cross(ref, n)); v = normalize(cross(n, u))
    return Basis(plane.point, u, v, n)

def mark_disk(grid: Grid, u: float, v: float, radius: float, *, blocked=False, cost=0.0) -> None:
    """Block/charge every cell whose center lies inside the disk.

    距离必须按连续坐标计算（格心 = min + (i+0.5)*cell），
    若按格索引差近似会把 disk 中心吸附到格心，产生至多半格的偏差，
    导致贴近格边界的障碍被漏挡，破坏安全地图的保守性。
    """
    r = int(math.ceil(radius / grid.cell)) + 1
    cx, cy = grid.cell_of(u, v)
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            if not grid.inside(x,y): continue
            gx = grid.min_u + (x + 0.5) * grid.cell
            gy = grid.min_v + (y + 0.5) * grid.cell
            d = math.hypot(gx - u, gy - v)
            if d <= radius:
                i = grid.index(x,y)
                if blocked: grid.blocked[i] = True
                if cost: grid.cost[i] += cost * max(0.0, 1.0-d/max(radius,1e-9))

def inflate_blocked(grid: Grid, radius: float) -> None:
    original = list(grid.blocked); r = max(0, int(math.ceil(radius/grid.cell)))
    for y in range(grid.height):
        for x in range(grid.width):
            if not original[grid.index(x,y)]: continue
            for yy in range(max(0,y-r), min(grid.height,y+r+1)):
                for xx in range(max(0,x-r), min(grid.width,x+r+1)):
                    if math.hypot((xx-x)*grid.cell,(yy-y)*grid.cell) <= radius:
                        grid.blocked[grid.index(xx,yy)] = True

def build_grid(points: list[Vec3], plane: Plane, ground_inliers: list[Vec3], cell: float, obstacle_height: float) -> tuple[Grid, Basis, dict[str,int]]:
    basis = make_basis(plane); projected = [basis.project(p) for p in points]; grounds = [basis.project(p) for p in ground_inliers]
    min_u,max_u = min(p[0] for p in projected)-cell, max(p[0] for p in projected)+cell
    min_v,max_v = min(p[1] for p in projected)-cell, max(p[1] for p in projected)+cell
    width,height = max(1,int(math.ceil((max_u-min_u)/cell))+1), max(1,int(math.ceil((max_v-min_v)/cell))+1)
    grid = Grid(min_u,min_v,cell,width,height,[1.0]*(width*height),[False]*(width*height),[False]*(width*height))
    for u,v,_ in grounds:
        x,y=grid.cell_of(u,v)
        if grid.inside(x,y): grid.ground[grid.index(x,y)] = True
    heights: dict[int,list[float]] = {}
    for u,v,h in projected:
        x,y=grid.cell_of(u,v)
        if grid.inside(x,y): heights.setdefault(grid.index(x,y),[]).append(h)
    obstacle_cells=0
    for i,hs in heights.items():
        if max(abs(h) for h in hs) >= obstacle_height:
            grid.blocked[i]=True; obstacle_cells+=1
    return grid,basis,{"groundCells":sum(grid.ground),"obstacleCells":obstacle_cells,"width":width,"height":height}

def valid_ground_cell(grid: Grid, x:int, y:int) -> bool:
    return grid.inside(x,y) and grid.ground[grid.index(x,y)] and not grid.blocked[grid.index(x,y)]

def nearest_ground_cell(grid: Grid, basis: Basis, p: Vec3, max_radius_cells=30) -> tuple[int,int] | None:
    u,v,_ = basis.project(p); sx,sy=grid.cell_of(u,v)
    best=None
    for radius in range(max_radius_cells+1):
        for y in range(max(0,sy-radius), min(grid.height,sy+radius+1)):
            for x in range(max(0,sx-radius), min(grid.width,sx+radius+1)):
                if not valid_ground_cell(grid,x,y): continue
                d=math.hypot(x-sx,y-sy)
                if best is None or d < best[0]: best=(d,x,y)
        if best is not None and radius >= best[0]: break
    return None if best is None else (best[1],best[2])

def astar(grid: Grid, start: tuple[int,int], goal: tuple[int,int]) -> list[tuple[int,int]] | None:
    if not valid_ground_cell(grid,*start) or not valid_ground_cell(grid,*goal): return None
    q=[(0.0,0.0,start)]; came={}; gscore={start:0.0}; closed=set()
    def h(a,b): return math.hypot(a[0]-b[0], a[1]-b[1])
    while q:
        _,g,current=heapq.heappop(q)
        if current in closed: continue
        closed.add(current)
        if current==goal:
            path=[current]
            while current in came: current=came[current]; path.append(current)
            return list(reversed(path))
        cx,cy=current
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            nx,ny=cx+dx,cy+dy
            if not valid_ground_cell(grid,nx,ny): continue
            if dx and dy and (not valid_ground_cell(grid,cx+dx,cy) or not valid_ground_cell(grid,cx,cy+dy)): continue
            step=math.sqrt(2.0) if dx and dy else 1.0
            tentative=gscore[current]+step+grid.cost[grid.index(nx,ny)]
            nxt=(nx,ny)
            if tentative < gscore.get(nxt,math.inf):
                came[nxt]=current; gscore[nxt]=tentative; heapq.heappush(q,(tentative+h(nxt,goal),tentative,nxt))
    return None

def apply_semantic_hazards(grid:Grid,basis:Basis,objects:Iterable[dict[str,Any]],clearance:float)->dict[str,int]:
    hard=soft=0
    for obj in objects:
        cat,pos=obj.get("category"),obj.get("position")
        if cat not in HARD_CATEGORIES and cat not in SOFT_COST: continue
        if not isinstance(pos,dict): continue
        u,v,_=basis.project((float(pos["x"]),float(pos["y"]),float(pos["z"])))
        r=float(obj.get("clearanceRadius",clearance))
        if cat in HARD_CATEGORIES: mark_disk(grid,u,v,r,blocked=True); hard+=1
        else: mark_disk(grid,u,v,r,cost=SOFT_COST[cat]); soft+=1
    return {"hard":hard,"soft":soft}

def path_to_points(grid:Grid,basis:Basis,path:list[tuple[int,int]])->list[dict[str,float]]:
    out=[]
    for x,y in path:
        p=basis.unproject(grid.min_u+(x+0.5)*grid.cell,grid.min_v+(y+0.5)*grid.cell,0.0)
        out.append({"x":round(p[0],6),"y":round(p[1],6),"z":round(p[2],6)})
    return out

def hazard_evidence_for_path(snapshot:dict[str,Any], basis:Basis, path_points:list[dict[str,float]], cell:float, clearance:float) -> tuple[list[str], list[dict[str,Any]]]:
    hazard_ids: list[str] = []
    evidence: list[dict[str,Any]] = []
    path_uv = [basis.project((float(p["x"]),float(p["y"]),float(p["z"]))) for p in path_points]
    for obj in snapshot.get("objects",[]):
        category = obj.get("category")
        object_id = obj.get("id")
        position = obj.get("position")
        if category not in HARD_CATEGORIES and category not in SOFT_COST:
            continue
        if not object_id or not isinstance(position,dict):
            continue
        try:
            hazard_uv = basis.project((float(position["x"]),float(position["y"]),float(position["z"])))
        except (TypeError, ValueError, KeyError):
            continue
        min_distance = min(
            math.hypot(hazard_uv[0]-path_uv_point[0], hazard_uv[1]-path_uv_point[1])
            for path_uv_point in path_uv
        )
        hazard_radius = float(obj.get("clearanceRadius", clearance))
        route_corridor = hazard_radius + 1.5 * cell
        if min_distance <= route_corridor:
            hazard_ids.append(str(object_id))
            evidence.append({
                "objectId": str(object_id),
                "category": category,
                "minDistanceUnits": round(min_distance, 6),
                "corridorRadiusUnits": round(route_corridor, 6),
                "rule": "path-point-proximity-with-clearance",
                "objectObservedAt": obj.get("observedAt"),
                "objectEvidence": obj.get("evidence"),
            })
    return sorted(set(hazard_ids)), evidence

def load_meters_per_unit(path:Path|None)->float|None:
    if path is None or not path.exists(): return None
    d=json.loads(path.read_text(encoding="utf-8")); value=d.get("metresPerUnit",d.get("metersPerUnit"))
    if not isinstance(value,(int,float)) or not math.isfinite(float(value)) or float(value)<=0: raise RuntimeError("scale.json 的 metresPerUnit 必须为正数")
    return float(value)

def surface_metadata(plane,support,grid,stats,semantic,mpu):
    return {"evidenceLevel":"sparse-surface","planeRole":"candidate-ground","planeSupportRatio":round(support,4),"planePoint":{"x":plane.point[0],"y":plane.point[1],"z":plane.point[2]},"planeNormal":{"x":plane.normal[0],"y":plane.normal[1],"z":plane.normal[2]},"grid":{"width":stats["width"],"height":stats["height"],"cellSizeUnits":grid.cell},"groundCells":stats["groundCells"],"obstacleCells":stats["obstacleCells"],"semanticHardHazards":semantic["hard"],"semanticSoftHazards":semantic["soft"],"metresPerUnit":mpu,"metricScaleAvailable":mpu is not None,"unknownCellsBlocked":True}

def plan_surface(snapshot,points,cell,plane_threshold,obstacle_height,clearance,metres_per_unit):
    plane,inliers,support=estimate_candidate_ground(points,plane_threshold)
    grid,basis,stats=build_grid(points,plane,inliers,cell,obstacle_height)
    semantic=apply_semantic_hazards(grid,basis,snapshot.get("objects",[]),clearance)
    for i,supported in enumerate(grid.ground):
        if not supported: grid.blocked[i]=True
    inflate_blocked(grid,clearance)
    surface=surface_metadata(plane,support,grid,stats,semantic,metres_per_unit)
    bed=next((o for o in snapshot.get("objects",[]) if o.get("category")=="bed"),None)
    toilet=next((o for o in snapshot.get("objects",[]) if o.get("category")=="toilet"),None)
    if not bed or not toilet: return {"status":"unavailable","reason":"缺少床或卫生间三维对象。","surface":surface}
    start=nearest_ground_cell(grid,basis,(float(bed["position"]["x"]),float(bed["position"]["y"]),float(bed["position"]["z"])))
    goal=nearest_ground_cell(grid,basis,(float(toilet["position"]["x"]),float(toilet["position"]["y"]),float(toilet["position"]["z"])))
    if start is None or goal is None: return {"status":"unavailable","reason":"床或卫生间无法吸附到有地面证据的自由栅格。","surface":surface}
    path=astar(grid,start,goal)
    if path is None: return {"status":"unavailable","reason":"地面证据与障碍膨胀后没有连通的候选通行空间。","surface":surface}
    path_points = path_to_points(grid,basis,path)
    hazard_ids, hazard_evidence = hazard_evidence_for_path(snapshot,basis,path_points,grid.cell,clearance)
    length=(len(path)-1)*grid.cell; metres=length*metres_per_unit if metres_per_unit else None
    return {"status":"candidate","route":{"id":"bed-to-toilet-surface-candidate","title":"床 → 卫生间（表面代价图候选路线）","startCell":{"x":start[0],"y":start[1]},"goalCell":{"x":goal[0],"y":goal[1]},"pathPoints3D":path_points,"gridSteps":len(path),"reconstructionLength":round(length,6),"lengthMetres":round(metres,3) if metres is not None else None,"confidence":round(min(float(bed.get("confidence",0.0)),float(toilet.get("confidence",0.0)),support),4),"source":"surface-inferred","safetyStatus":"needs-real-scale-and-surface-validation","hazardIds":hazard_ids,"hazardEvidence":hazard_evidence,"warning":"候选路径来自稀疏表面点与语义障碍投影；仍需真实尺度、连续表面、通行宽度和现场复核。"},"surface":surface}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--snapshot",required=True,type=Path); ap.add_argument("--points",required=True,type=Path); ap.add_argument("--output",required=True,type=Path); ap.add_argument("--cell",type=float,default=0.05); ap.add_argument("--plane-threshold",type=float,default=0.02); ap.add_argument("--obstacle-height",type=float,default=0.08); ap.add_argument("--clearance",type=float,default=0.18); ap.add_argument("--scale",type=Path,default=None); args=ap.parse_args()
    if min(args.cell,args.plane_threshold,args.obstacle_height,args.clearance)<=0: raise RuntimeError("cell/plane-threshold/obstacle-height/clearance 必须为正数")
    snapshot=json.loads(args.snapshot.read_text(encoding="utf-8")); points=load_points(args.points); mpu=load_meters_per_unit(args.scale)
    result=plan_surface(snapshot,points,args.cell,args.plane_threshold,args.obstacle_height,args.clearance,mpu); snapshot["surfaceWalkability"]=result
    args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"surface walkability status: {result['status']}"); print(f"metric scale available: {bool(result.get('surface',{}).get('metricScaleAvailable',False))}")
    if result.get("route"): print(f"surface path steps: {result['route']['gridSteps']}")

if __name__=="__main__":
    try: main()
    except Exception as exc: print(f"ERROR: {exc}"); raise SystemExit(1)