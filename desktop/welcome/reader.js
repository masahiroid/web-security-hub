'use strict';
const article=document.querySelector('main');
const toc=document.createElement('nav');toc.className='reader-nav';toc.setAttribute('aria-label','Contents');
const home=document.createElement('a');home.href='/welcome';home.textContent='← ホーム / Home';toc.append(home);
article.querySelectorAll('h2').forEach((heading,i)=>{heading.id ||= `chapter-${i}`; const a=document.createElement('a');a.href=`#${heading.id}`;a.textContent=heading.textContent;a.onclick=e=>{e.preventDefault();heading.scrollIntoView({block:'start'});toc.querySelectorAll('a').forEach(link=>link.classList.toggle('selected',link===a));};toc.append(a);});
document.body.append(toc);document.body.classList.add('desktop-reader');
