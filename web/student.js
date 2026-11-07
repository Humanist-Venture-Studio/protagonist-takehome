// Shared by the student pages; the server inlines it so the hash-based CSP covers it.
(()=>{
  // Skip to content focuses the page's content without changing the address, which on /me picks the view.
  document.querySelector('.skip')?.addEventListener('click',e=>{e.preventDefault();document.getElementById('main')?.focus();});
  // When an on-screen keyboard shrinks the visible area, keep the focused field in view inside the page's scroll area.
  const vv=window.visualViewport,scroller=document.querySelector('[data-scroll]');
  if(vv&&scroller)vv.addEventListener('resize',()=>{
    const f=document.activeElement;if(!f||!scroller.contains(f)||!f.matches('input,select,textarea'))return;
    const r=f.getBoundingClientRect(),bottom=vv.offsetTop+vv.height;
    if(r.top<scroller.getBoundingClientRect().top||r.top>bottom-48)f.scrollIntoView({block:'nearest'});
  });
})();
