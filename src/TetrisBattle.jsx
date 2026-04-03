import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

const SERVER_URL = "https://tetris-server-production-e3c5.up.railway.app/";

const COLS = 10, ROWS = 20;
const PIECES = {
  I: { matrix: [[1,1,1,1]], color: "#00f5ff" },
  O: { matrix: [[1,1],[1,1]], color: "#ffe600" },
  T: { matrix: [[0,1,0],[1,1,1]], color: "#8338ec" },
  S: { matrix: [[0,1,1],[1,1,0]], color: "#06d6a0" },
  Z: { matrix: [[1,1,0],[0,1,1]], color: "#ff006e" },
  J: { matrix: [[1,0,0],[1,1,1]], color: "#3a86ff" },
  L: { matrix: [[0,0,1],[1,1,1]], color: "#fb5607" },
};
const PKEYS = Object.keys(PIECES);
const newBoard = () => Array.from({length: ROWS}, () => Array(COLS).fill(null));
const rotateMat = m => {
  const R = m.length, C = m[0].length;
  return Array.from({length: C}, (_, j) => Array.from({length: R}, (_, i) => m[R-1-i][j]));
};
const newPiece = () => {
  const k = PKEYS[Math.floor(Math.random() * PKEYS.length)];
  const mat = PIECES[k].matrix.map(r => [...r]);
  return { color: PIECES[k].color, matrix: mat, x: Math.floor(COLS/2) - Math.floor(mat[0].length/2), y: 0 };
};
const fits = (board, piece, dx=0, dy=0, mat=null) => {
  const m = mat || piece.matrix;
  for (let r=0; r<m.length; r++)
    for (let c=0; c<m[r].length; c++)
      if (m[r][c]) {
        const nx = piece.x+c+dx, ny = piece.y+r+dy;
        if (nx<0||nx>=COLS||ny>=ROWS) return false;
        if (ny>=0 && board[ny][nx]) return false;
      }
  return true;
};

const compressBoard = (board) =>
  board.map(row => row.map(c => c ? 1 : 0));

export default function TetrisBattle() {
  const socketRef = useRef(null);

  const [screen, setScreen] = useState("lobby");
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState("");
  const [roomList, setRoomList] = useState([]);
  const [roomData, setRoomData] = useState(null);
  const [myId, setMyId] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [resultData, setResultData] = useState(null);

  const G = useRef({
    board: newBoard(), cur: null, nxt: newPiece(),
    level: 1, lines: 0,
    over: false, dropT: 0, lastT: 0, raf: null,
    gameStartTime: 0,
  });
  const canvasRef = useRef(null);
  const nxtRef = useRef(null);
  const [ui, setUi] = useState({ level: 1, lines: 0 });
  const [eliminated, setEliminated] = useState(false);

  const [otherPlayers, setOtherPlayers] = useState({});

  const [BS, setBS] = useState(24);
  useEffect(() => {
    const calc = () => {
      const bh = Math.floor((window.innerHeight - 280) / ROWS);
      const bw = Math.floor((window.innerWidth - 120) / COLS);
      setBS(Math.max(16, Math.min(bh, bw, 28)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setMyId(socket.id);
      socket.emit("get_rooms");
    });

    socket.on("room_list", setRoomList);

    socket.on("room_update", (data) => {
      setRoomData(data);
      if (screen === "lobby") setScreen("room");
    });

    socket.on("game_start", ({ players }) => {
      setOtherPlayers(
        Object.fromEntries(
          Object.entries(players).filter(([id]) => id !== socket.id)
            .map(([id, p]) => [id, { ...p, board: null }])
        )
      );
      resetGame();
      setEliminated(false);
      setScreen("game");
    });

    socket.on("player_update", ({ id, board }) => {
      setOtherPlayers(prev => ({
        ...prev,
        [id]: { ...prev[id], board },
      }));
    });

    socket.on("player_eliminated", ({ id }) => {
      if (id === socket.id) {
        setEliminated(true);
      }
      setOtherPlayers(prev => ({
        ...prev,
        [id]: { ...prev[id], alive: false },
      }));
    });

    socket.on("game_end", ({ winner, players }) => {
      cancelAnimationFrame(G.current.raf);
      setResultData({ winner, players, myId: socket.id });
      setScreen("result");
    });

    socket.on("error_msg", (msg) => {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(""), 3000);
    });

    return () => socket.disconnect();
  }, []);

  const render = useCallback(() => {
    const cv = canvasRef.current, nc = nxtRef.current;
    if (!cv) return;
    const g = G.current, B = BS;
    const ctx = cv.getContext("2d");

    ctx.fillStyle = "#07070e";
    ctx.fillRect(0, 0, COLS*B, ROWS*B);
    ctx.strokeStyle = "rgba(255,255,255,0.035)"; ctx.lineWidth = 1;
    for (let r=0; r<=ROWS; r++) { ctx.beginPath(); ctx.moveTo(0,r*B); ctx.lineTo(COLS*B,r*B); ctx.stroke(); }
    for (let c=0; c<=COLS; c++) { ctx.beginPath(); ctx.moveTo(c*B,0); ctx.lineTo(c*B,ROWS*B); ctx.stroke(); }

    g.board.forEach((row,r) => row.forEach((col,c) => col && blk(ctx,c,r,col,B)));

    if (g.cur) {
      let dy=0; while (fits(g.board,g.cur,0,dy+1)) dy++;
      if (dy>0) g.cur.matrix.forEach((row,r) => row.forEach((v,c) => {
        if(v){ctx.strokeStyle=g.cur.color+"44";ctx.lineWidth=1;ctx.strokeRect((g.cur.x+c)*B+1,(g.cur.y+r+dy)*B+1,B-2,B-2);}
      }));
      g.cur.matrix.forEach((row,r) => row.forEach((v,c) => { if(v) blk(ctx,g.cur.x+c,g.cur.y+r,g.cur.color,B); }));
    }

    if (nc) {
      const NB=18, nctx=nc.getContext("2d");
      nctx.fillStyle="#0d0d1a"; nctx.fillRect(0,0,80,80);
      if (g.nxt) {
        const ox=Math.floor((4-g.nxt.matrix[0].length)/2), oy=Math.floor((4-g.nxt.matrix.length)/2);
        g.nxt.matrix.forEach((row,r)=>row.forEach((v,c)=>{
          if(v){nctx.fillStyle=g.nxt.color;nctx.fillRect((ox+c)*NB+2,(oy+r)*NB+2,NB-3,NB-3);}
        }));
      }
    }
  }, [BS]);

  const blk = (ctx,x,y,color,B) => {
    ctx.fillStyle=color; ctx.fillRect(x*B+1,y*B+1,B-2,B-2);
    ctx.fillStyle="rgba(255,255,255,.15)"; ctx.fillRect(x*B+1,y*B+1,B-2,4); ctx.fillRect(x*B+1,y*B+1,4,B-2);
  };

  const endGame = useCallback(() => {
    const g = G.current;
    g.over = true;
    cancelAnimationFrame(g.raf);
    setEliminated(true);
    socketRef.current?.emit("game_over", {});
  }, []);

  const place = useCallback(() => {
    const g = G.current;
    let lost = false;
    g.cur.matrix.forEach((row,r)=>row.forEach((v,c)=>{
      if(v){const ny=g.cur.y+r; if(ny<0){lost=true;return;} g.board[ny][g.cur.x+c]=g.cur.color;}
    }));
    if (lost) { endGame(); return; }
    let cl=0;
    for (let r=ROWS-1;r>=0;r--) {
      if(g.board[r].every(c=>c)){g.board.splice(r,1);g.board.unshift(Array(COLS).fill(null));cl++;r++;}
    }
    if (cl) { g.lines += cl; }
    g.cur=g.nxt; g.nxt=newPiece();
    if (!fits(g.board,g.cur)) { endGame(); return; }
    setUi(u => ({...u, lines: g.lines}));

    socketRef.current?.emit("game_update", {
      board: compressBoard(g.board),
    });
  }, [endGame]);

  // Her 30 saniyede bir seviye artar
  const speed = lv => Math.max(80, 500-(lv-1)*60);

  const tick = useCallback((t=0) => {
    const g = G.current;
    if (g.over) return;
    const delta = t - g.lastT; g.lastT = t;

    const newLevel = Math.floor((t - g.gameStartTime) / 30000) + 1;
    if (newLevel !== g.level) {
      g.level = newLevel;
      setUi(u => ({...u, level: g.level}));
    }

    g.dropT += delta;
    if (g.dropT >= speed(g.level)) {
      if (fits(g.board,g.cur,0,1)) g.cur.y++; else place();
      g.dropT = 0;
    }
    render();
    g.raf = requestAnimationFrame(tick);
  }, [render, place]);

  const resetGame = useCallback(() => {
    const g = G.current;
    cancelAnimationFrame(g.raf);
    Object.assign(g, {board:newBoard(), level:1, lines:0, over:false, dropT:0, lastT:0, gameStartTime:0});
    g.cur = newPiece(); g.nxt = newPiece();
    setUi({level:1, lines:0});
    g.raf = requestAnimationFrame((t) => {
      g.gameStartTime = t;
      g.lastT = t;
      tick(t);
    });
  }, [tick]);

  const act = useCallback((action) => {
    const g = G.current;
    if (g.over || !g.cur) return;
    switch(action) {
      case "L": if(fits(g.board,g.cur,-1)) g.cur.x--; break;
      case "R": if(fits(g.board,g.cur,1)) g.cur.x++; break;
      case "D":
        if(fits(g.board,g.cur,0,1)){g.cur.y++;g.dropT=0;}
        else{place();return;}
        break;
      case "T": {
        const rot=rotateMat(g.cur.matrix);
        for(const k of [0,1,-1,2,-2]){
          if(fits(g.board,g.cur,k,0,rot)){g.cur.matrix=rot;g.cur.x+=k;break;}
        }
        break;
      }
      case "DROP": {
        let dy=0; while(fits(g.board,g.cur,0,dy+1))dy++;
        g.cur.y+=dy; place(); return;
      }
    }
    render();
  }, [render, place]);

  useEffect(() => {
    const map = {ArrowLeft:"L",ArrowRight:"R",ArrowDown:"D",ArrowUp:"T",Space:"DROP"};
    const h = e => { if(map[e.code]){e.preventDefault();act(map[e.code]);} };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  },[act]);

  useEffect(()=>{ if(screen==="game") render(); },[render,BS,screen]);

  const downTimer = useRef(null);
  const stopDown = useCallback(() => {
    if (downTimer.current) { clearInterval(downTimer.current); downTimer.current=null; }
  }, []);
  const startDown = useCallback((e) => {
    e.preventDefault();
    stopDown();
    act("D");
    downTimer.current = setInterval(()=>act("D"), 140);
  }, [act, stopDown]);
  useEffect(() => {
    window.addEventListener("pointerup", stopDown);
    window.addEventListener("pointercancel", stopDown);
    return () => { window.removeEventListener("pointerup", stopDown); window.removeEventListener("pointercancel", stopDown); stopDown(); };
  }, [stopDown]);

  const Btn = ({label, color="#00f5ff", w=72, h=72, fs=26, onPress}) => (
    <div onPointerDown={(e)=>{e.preventDefault();onPress();}}
      style={{width:w,height:h,borderRadius:14,fontSize:fs,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(14,14,24,0.97)",border:`1.5px solid ${color}55`,color,cursor:"pointer",userSelect:"none",WebkitUserSelect:"none",touchAction:"none",boxShadow:`0 0 16px ${color}20`,fontFamily:"'Share Tech Mono',monospace",flexShrink:0}}
    >{label}</div>
  );

  const MiniBoard = ({ board, alive, nickname }) => {
    const MB = 4;
    return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,opacity:alive===false?0.35:1}}>
        <div style={{fontSize:8,color:"#ffffff88",letterSpacing:"0.05em",maxWidth:50,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nickname}</div>
        <div style={{width:COLS*MB,height:ROWS*MB,background:"#0a0a14",border:`1px solid ${alive===false?"#ff006e33":"#1a1a2e"}`,position:"relative",overflow:"hidden"}}>
          {board && board.map((row,r) => row.map((v,c) => v ? (
            <div key={`${r}-${c}`} style={{position:"absolute",left:c*MB,top:r*MB,width:MB-1,height:MB-1,background:"#00f5ff",opacity:0.8}}/>
          ) : null))}
          {alive === false && (
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.6)",fontSize:8,color:"#ff006e",fontFamily:"'Orbitron',monospace",letterSpacing:"0.05em"}}>
              ELENDİ
            </div>
          )}
        </div>
      </div>
    );
  };

  const inputStyle = {
    background:"rgba(15,15,26,0.9)",
    border:"1px solid #1a1a2e",
    color:"#e0e0ff",
    fontFamily:"'Share Tech Mono',monospace",
    fontSize:14,
    padding:"10px 14px",
    borderRadius:8,
    outline:"none",
    width:"100%",
  };

  const actionBtnStyle = (color="#00f5ff") => ({
    background:"transparent",
    border:`1.5px solid ${color}`,
    color,
    fontFamily:"'Orbitron',monospace",
    fontSize:11,
    letterSpacing:"0.15em",
    padding:"12px 0",
    cursor:"pointer",
    borderRadius:8,
    width:"100%",
    boxShadow:`0 0 16px ${color}33`,
  });

  if (screen === "lobby") return (
    <div style={{background:"#07070e",minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Orbitron',monospace",padding:20,gap:20}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#07070e;}`}</style>
      <div style={{fontSize:28,fontWeight:900,color:"#00f5ff",textShadow:"0 0 20px #00f5ff88",letterSpacing:"0.3em"}}>TETRİS</div>
      <div style={{fontSize:11,color:"#ffffff44",letterSpacing:"0.2em",marginTop:-14}}>BATTLE</div>
      <div style={{width:"100%",maxWidth:320,display:"flex",flexDirection:"column",gap:12}}>
        <input style={inputStyle} placeholder="Kullanıcı adın" value={nickname} onChange={e=>setNickname(e.target.value)} maxLength={16}/>
        <input style={inputStyle} placeholder="Oda adı (yeni veya mevcut)" value={roomId} onChange={e=>setRoomId(e.target.value.toUpperCase())} maxLength={12}/>
        {errorMsg && <div style={{fontSize:11,color:"#ff006e",textAlign:"center"}}>{errorMsg}</div>}
        <button style={actionBtnStyle("#00f5ff")} onClick={()=>{
          if (!nickname.trim()) { setErrorMsg("Kullanıcı adı gir."); return; }
          if (!roomId.trim()) { setErrorMsg("Oda adı gir."); return; }
          socketRef.current?.emit("join_room", { roomId: roomId.trim(), nickname: nickname.trim() });
        }}>ODA GİR / OLUŞTUR</button>
      </div>
      {roomList.length > 0 && (
        <div style={{width:"100%",maxWidth:320}}>
          <div style={{fontSize:9,color:"#ffffff44",letterSpacing:"0.2em",marginBottom:8}}>AKTİF ODALAR</div>
          {roomList.map(r => (
            <div key={r.id} onPointerDown={()=>{ if(!nickname.trim()){setErrorMsg("Önce kullanıcı adı gir.");return;} setRoomId(r.id); socketRef.current?.emit("join_room",{roomId:r.id,nickname:nickname.trim()}); }}
              style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(15,15,26,0.8)",border:"1px solid #1a1a2e",borderRadius:8,marginBottom:6,cursor:"pointer",color:"#e0e0ff",fontFamily:"'Share Tech Mono',monospace",fontSize:12}}>
              <span style={{color:"#00f5ff"}}>{r.id}</span>
              <span style={{color:"#ffffff55"}}>{r.playerCount}/8 {r.started?"🔴":""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (screen === "room") return (
    <div style={{background:"#07070e",minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Orbitron',monospace",padding:20,gap:16}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#07070e;}`}</style>
      <div style={{fontSize:13,fontWeight:700,color:"#00f5ff",letterSpacing:"0.2em"}}>ODA: {roomId}</div>
      {errorMsg && <div style={{fontSize:11,color:"#ff006e"}}>{errorMsg}</div>}
      <div style={{width:"100%",maxWidth:320}}>
        <div style={{fontSize:9,color:"#ffffff44",letterSpacing:"0.2em",marginBottom:8}}>OYUNCULAR ({roomData ? Object.keys(roomData.players).length : 0}/8)</div>
        {roomData && Object.values(roomData.players).map(p => (
          <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"rgba(15,15,26,0.8)",border:"1px solid #1a1a2e",borderRadius:8,marginBottom:6,fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:"#e0e0ff"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:p.id===roomData.host?"#ffe600":"#00f5ff44",display:"inline-block"}}/>
            {p.nickname}
            {p.id === myId && <span style={{fontSize:9,color:"#ffffff44",marginLeft:"auto"}}>(sen)</span>}
            {p.id === roomData.host && <span style={{fontSize:9,color:"#ffe60088",marginLeft:"auto"}}>host</span>}
          </div>
        ))}
      </div>
      <div style={{width:"100%",maxWidth:320,display:"flex",flexDirection:"column",gap:10}}>
        {roomData?.host === myId ? (
          <button style={actionBtnStyle("#ffe600")} onClick={()=>socketRef.current?.emit("start_game")}>OYUNU BAŞLAT</button>
        ) : (
          <div style={{textAlign:"center",fontSize:11,color:"#ffffff44",letterSpacing:"0.15em"}}>Host oyunu başlatmayı bekle...</div>
        )}
        <button style={actionBtnStyle("#ff006e")} onClick={()=>{ socketRef.current?.emit("leave_room"); setScreen("lobby"); setRoomData(null); }}>ODADAN ÇIK</button>
      </div>
    </div>
  );

  if (screen === "result") return (
    <div style={{background:"#07070e",minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Orbitron',monospace",padding:20,gap:16}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#07070e;}`}</style>
      <div style={{fontSize:22,fontWeight:900,color:"#ffe600",textShadow:"0 0 20px #ffe60088",letterSpacing:"0.2em"}}>OYUN BİTTİ</div>
      {resultData && (
        <>
          <div style={{fontSize:13,color:"#00f5ff",marginBottom:8}}>🏆 {resultData.players[resultData.winner]?.nickname || "?"} kazandı!</div>
          <div style={{width:"100%",maxWidth:320}}>
            {Object.values(resultData.players).sort((a,b)=>(a.rank||99)-(b.rank||99)).map((p,i) => (
              <div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"10px 14px",background:"rgba(15,15,26,0.8)",border:`1px solid ${p.rank===1?"#ffe60033":"#1a1a2e"}`,borderRadius:8,marginBottom:6,fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:p.id===resultData.myId?"#00f5ff":"#e0e0ff"}}>
                <span>#{p.rank||"?"} {p.nickname}{p.id===resultData.myId?" (sen)":""}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{width:"100%",maxWidth:320,display:"flex",flexDirection:"column",gap:10}}>
        {roomData?.host === myId && (
          <button style={actionBtnStyle("#ffe600")} onClick={()=>socketRef.current?.emit("restart_game")}>TEKRAR OYNA</button>
        )}
        <button style={actionBtnStyle("#ff006e")} onClick={()=>{ socketRef.current?.emit("leave_room"); setScreen("lobby"); setRoomData(null); }}>LOBIYE DÖN</button>
      </div>
    </div>
  );

  const B = BS;
  const gameWidth = COLS*B + 8 + 92;
  const others = Object.values(otherPlayers);

  return (
    <div style={{background:"#07070e",minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",fontFamily:"'Orbitron',monospace",paddingTop:8,overflow:"hidden"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#07070e;}button{-webkit-tap-highlight-color:transparent;}`}</style>

      {/* Üst bar — oyun alanıyla hizalı */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:gameWidth,marginBottom:6}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:8,color:"#06d6a088",letterSpacing:"0.15em"}}>SATIR</div>
          <div style={{fontSize:18,fontWeight:900,color:"#06d6a0"}}>{ui.lines}</div>
        </div>
        <div style={{fontSize:13,fontWeight:900,letterSpacing:"0.2em",color:"#fff"}}>TETRİS BATTLE</div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:8,color:"#8338ec88"}}>SEVİYE</div>
          <div style={{fontSize:18,fontWeight:700,color:"#8338ec"}}>{ui.level}</div>
        </div>
      </div>

      <div style={{display:"flex",gap:8,padding:"0 6px",alignItems:"flex-start"}}>
        <div style={{position:"relative",flexShrink:0}}>
          <canvas ref={canvasRef} width={COLS*B} height={ROWS*B}
            style={{display:"block",border:"1px solid #1a1a2e",boxShadow:"0 0 20px rgba(0,245,255,0.05)"}}/>
          {eliminated && (
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(7,7,14,0.9)",backdropFilter:"blur(4px)"}}>
              <div style={{fontSize:18,fontWeight:900,color:"#ff006e",textShadow:"0 0 20px #ff006e88",marginBottom:6,letterSpacing:"0.1em"}}>ELENDİN</div>
              <div style={{fontSize:11,color:"#ffffff44",letterSpacing:"0.1em"}}>Diğerlerini izle...</div>
            </div>
          )}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:0}}>
          <div style={{background:"#0d0d1a",border:"1px solid #1a1a2e",padding:6,borderRadius:4}}>
            <div style={{fontSize:7,color:"#00f5ff88",letterSpacing:"0.15em",marginBottom:4}}>SONRAKİ</div>
            <canvas ref={nxtRef} width={80} height={80} style={{display:"block"}}/>
          </div>
          {others.length > 0 && (
            <div style={{background:"#0d0d1a",border:"1px solid #1a1a2e",padding:6,borderRadius:4}}>
              <div style={{fontSize:7,color:"#ffffff44",letterSpacing:"0.15em",marginBottom:6}}>OYUNCULAR</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {others.map(p => (
                  <MiniBoard key={p.id} board={p.board} alive={p.alive} nickname={p.nickname}/>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{marginTop:12,display:"flex",flexDirection:"column",alignItems:"center",gap:10,width:"100%",maxWidth:320,padding:"0 12px"}}>
        <Btn label="↻" color="#8338ec" w={72} h={54} fs={22} onPress={()=>act("T")}/>
        <div style={{display:"flex",gap:10}}>
          <Btn label="←" color="#00f5ff" onPress={()=>act("L")}/>
          <div onPointerDown={startDown}
            style={{width:72,height:72,borderRadius:14,fontSize:26,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(14,14,24,0.97)",border:"1.5px solid #06d6a055",color:"#06d6a0",cursor:"pointer",userSelect:"none",WebkitUserSelect:"none",touchAction:"none",boxShadow:"0 0 16px #06d6a020",fontFamily:"'Share Tech Mono',monospace",flexShrink:0}}
          >↓</div>
          <Btn label="→" color="#00f5ff" onPress={()=>act("R")}/>
        </div>
        <div onPointerDown={(e)=>{e.preventDefault();act("DROP");}}
          style={{width:"100%",height:52,borderRadius:12,fontSize:12,letterSpacing:"0.2em",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(14,14,24,0.97)",border:"1.5px solid #ff006e55",color:"#ff006e",cursor:"pointer",userSelect:"none",WebkitUserSelect:"none",touchAction:"none",fontFamily:"'Orbitron',monospace"}}
        >⬇ DÜŞÜR</div>
      </div>
    </div>
  );
}
