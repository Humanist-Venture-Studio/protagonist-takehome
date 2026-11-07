import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approveReply, deliveryProblem, plainText, replyProblem } from '../src/replies.ts';

const STOP='Send /stop to cancel.';
async function approveWithoutRewrite(text:string,kind:'final'|'progress',options:{prepared?:boolean}={}) {
  let calls=0;
  const result=await approveReply(text,kind,async()=>{calls++;throw Error('Unexpected rewrite');},options);
  assert.equal(calls,0,'A readable or prepared reply must not spend another model call');
  return result;
}

test('headings, emphasis and Markdown links become readable plain text without losing dates or URL syntax',()=>{
  const url='https://college.example/program_(evening)?year=2027&mode=part_time';
  const original=`## Your goal\n\n**Return to college** by January 1st, 2027.\n\nRead [the _program_ page](${url}).\n\n* Confirm your program\n* Choose a term`;
  const result=plainText(original);
  assert.equal(result,`Your goal\n\nReturn to college by January 1st, 2027.\n\nRead the program page (${url}).\n\n- Confirm your program\n- Choose a term`);
  assert.equal(replyProblem(result,'final'),null);
  assert.equal(plainText(result),result);
});

test('balanced nested parentheses in URLs and escaped destination punctuation survive link conversion',()=>{
  const examples=[
    ['[Course](https://example.edu/a_(b_(c))?x=1&value=a_b)','Course (https://example.edu/a_(b_(c))?x=1&value=a_b)'],
    ['[Course](https://example.edu/a_\\(b\\))','Course (https://example.edu/a_(b))'],
    ['<https://example.edu/a_b?x=1>','https://example.edu/a_b?x=1'],
    ['[https://example.edu/a_b](https://example.edu/a_b)','https://example.edu/a_b'],
    ['![Schedule](https://example.edu/schedule.png)','Schedule (https://example.edu/schedule.png)'],
  ];
  for(const [input,expected] of examples) {
    const output=plainText(input);
    assert.equal(output,expected);
    assert.equal(plainText(output),output);
    assert.equal(replyProblem(output,'final'),null);
  }
});

test('literal math, underscores, accented text, emoji and safe escaped punctuation remain intact',()=>{
  const original='Compare A* and A_B programs. café 🙂 <3: x_y = 2 * 3 ** 2; 3 + 4 = 7. Really\\?';
  const output=plainText(original);
  assert.equal(output,'Compare A* and A_B programs. café 🙂 <3: x_y = 2 * 3 ** 2; 3 + 4 = 7. Really?');
  assert.equal(replyProblem(output,'final'),null);
  assert.equal(plainText(output),output);
  assert.equal(plainText('`snake_case` and `x_y = 2 * 3`'),'snake_case and x_y = 2 * 3');
});

test('literal escaped markers retain provenance so normalization is idempotent',()=>{
  const original=String.raw`\*literal asterisks\* and \_literal underscores\_ and \[brackets\].`;
  assert.equal(plainText(original),original);
  assert.equal(plainText(plainText(original)),original);
  assert.equal(replyProblem(original,'final'),null);
});

test('nested emphasis converts once; literal markup inside code requests a rewrite',()=>{
  assert.equal(plainText('***Warm*** and **bold _italic_**, __clear__ and _brief_.'),'Warm and bold italic, clear and brief.');
  const code='```text\n**literal stars**\n```';
  assert.equal(plainText(code),code,'ambiguous code keeps its literal punctuation and complete original content');
  assert.ok(replyProblem(plainText(code),'final'));
  assert.equal(plainText('```js\nconst x_y = 2 * 3;\n```'),'const x_y = 2 * 3;');
});

test('a table retains every heading and cell in a simple text list',()=>{
  const output=plainText('| School | Start | Cost |\n|:---|---:|---|\n| Example College | 2027-01-01 | $100 |\n| Sample College | 2027-02-01 | $200 |');
  assert.equal(output,'- School: Example College; Start: 2027-01-01; Cost: $100\n- School: Sample College; Start: 2027-02-01; Cost: $200');
  assert.equal(replyProblem(output,'final'),null);
  assert.equal(plainText(output),output);
  const malformed='| School | Cost |\n|---|---|\n| Example | $100 | Extra information |';
  assert.equal(plainText(malformed),malformed);
  assert.ok(replyProblem(plainText(malformed),'final'));
});

test('unclosed or unsupported markup is rejected rather than partially delivered',()=>{
  for(const value of [
    '**unfinished bold',
    '[Course](https://example.edu',
    '[Course](https://example.edu "Useful title")',
    '```text\nunfinished code',
    '<b>HTML</b>',
    '> A quotation requiring context',
    '- [x] A completed task',
    '~~cancelled~~',
  ])assert.ok(replyProblem(plainText(value),'final'),value);
});

test('final limits count Unicode code points and whitespace words without truncating',()=>{
  assert.equal(replyProblem('🙂'.repeat(700),'final'),null);
  assert.match(replyProblem('🙂'.repeat(701),'final')!,/character/);
  assert.equal(replyProblem(Array(120).fill('a').join(' '),'final'),null);
  assert.match(replyProblem(Array(121).fill('a').join(' '),'final')!,/words/);
  assert.equal(replyProblem('é'.repeat(700),'final'),null);
  assert.ok(replyProblem('','final'));
  assert.ok(replyProblem('A\u0000B','final'));
});

test('questions in URLs are ignored, while English, Arabic and fullwidth questions share one limit',()=>{
  assert.equal(replyProblem('See https://example.edu/?a=1&b=2. Which term works?','final'),null);
  assert.ok(replyProblem('Which term? Which school?','final'));
  assert.ok(replyProblem('Ready؟ Which term?','final'));
  assert.ok(replyProblem('Ready？ Which term؟','final'));
});

test('question guidance still detects bundles without blocking a short answer',async()=>{
  const bundled='Which college or field are you aiming for right now, and what is your time zone?';
  assert.match(replyProblem(bundled,'final')!,/one focused piece/);
  for(const question of [
    'Which college are you considering and where do you live?',
    'What program do you want and when can you start?',
    'Which program interests you and how much time do you have?',
    'What program do you want and who is your adviser?',
    '¿Qué programa te interesa y cuál es tu zona horaria?',
    '¿Qué programa te interesa y dónde vives?',
    '¿Qué programa te interesa y cuándo puedes empezar?',
    '¿Qué programa te interesa y cómo prefieres estudiar?',
  ])assert.match(replyProblem(question,'final')!,/one focused piece/,question);
  assert.deepEqual(await approveWithoutRewrite(bundled,'final'),{text:bundled,fallback:false});
});

test('question-bundle detection does not reject ordinary explanatory prose or a single choice',()=>{
  for(const text of [
    'I checked what the college needs and how to apply.',
    'I checked what the college needs and how to apply. Which program interests you?',
    'Revisé qué pide la universidad y cómo solicitar admisión. ¿Qué programa te interesa?',
    'Which college or field interests you most?',
    'Which option works better, evening or weekend classes?',
  ])assert.equal(replyProblem(text,'final'),null,text);
});

test('paragraphs and simple bullets have separate practical limits',()=>{
  assert.equal(replyProblem('One short answer.','final'),null);
  assert.equal(replyProblem('One\n\nTwo\n\nThree\n\nFour','final'),null);
  assert.ok(replyProblem('One\n\nTwo\n\nThree\n\nFour\n\nFive','final'));
  assert.equal(replyProblem('- One\n- Two\n- Three','final'),null);
  assert.ok(replyProblem('- One\n- Two\n- Three\n- Four','final'));
  assert.equal(plainText('1. First\n2. Second'),'- 1. First\n- 2. Second','ordered step numbers are preserved');
});

test('formatting alone approves a short reply without invoking rewrite',async()=>{
  assert.deepEqual(await approveWithoutRewrite('**Saved.** Which program interests you?','final'),
    {text:'Saved. Which program interests you?',fallback:false});
});

test('an oversized answer gets exactly one rewrite with the full original and all essential literals',async()=>{
  const url='https://example.edu/course_(evening)?term=2027';
  const original=`**Target:** January 1st, 2027. [Program](${url})\n\n${'Additional explanation. '.repeat(45)}`;
  let count=0;
  const result=await approveReply(original,'final',async(text,kind)=>{
    count++;
    assert.equal(text,original,'the rewrite sees all content, including the tail');
    assert.equal(kind,'final');
    return `Target: January 1st, 2027.\n\nProgram: ${url}\n\nWhich program interests you?`;
  });
  assert.equal(count,1);
  assert.equal(result.fallback,false);
  assert.ok(result.text.includes(url));
  assert.ok(result.text.includes('January 1st, 2027'));
  assert.equal(replyProblem(result.text,'final'),null);
});

test('rewrites cannot silently omit a URL or an explicit calendar date',async()=>{
  const examples=[
    ['January 1st, 2027','January 2nd, 2027'],
    ['2027-01-01','2027-01-02'],
    ['01/01/2027','02/01/2027'],
    ['1 de enero de 2027','2 de enero de 2027'],
    ['https://example.edu/path_(a)?x=1','https://other.example.edu/'],
  ];
  for(const [essential,replacement] of examples) {
    for(const repetitions of [80,400]) {
      const original=`Important: ${essential}. ${'Explanation. '.repeat(repetitions)}`;
      const result=await approveReply(original,'final',async()=>`Important: ${replacement}.`);
      assert.equal(result.fallback,repetitions===400,essential);
      if(repetitions===80)assert.equal(result.text,original.trim());
      else assert.match(result.text,/couldn’t prepare/);
    }
  }
});

test('short final answers ignore cosmetic style violations without another model call',async()=>{
  for(const original of [
    'Hi! How are you? What would you like to work on today?',
    'Hi!\n\nWelcome.\n\nI can help.\n\nLet’s begin.\n\nWhat would you like to work on?',
    '- First\n- Second\n- Third\n- Fourth',
    'Literal code: `**stars**`',
  ]) {
    const result=await approveWithoutRewrite(original,'final');
    assert.deepEqual(result,{text:plainText(original),fallback:false});
  }
});

test('a deliverable original survives failed, unusable, or longer shortening attempts',async()=>{
  for(const rewrite of [async()=>'y'.repeat(3901),async()=>{throw Error('Provider unavailable');},async()=>'',async()=>'A\u0000B',async()=>'y'.repeat(800)]) {
    let calls=0;const original='x'.repeat(701);
    const result=await approveReply(original,'final',async()=>{calls++;return rewrite();});
    assert.equal(calls,1);
    assert.deepEqual(result,{text:original,fallback:false});
    assert.deepEqual(await approveWithoutRewrite(result.text,'final',{prepared:true}),result);
  }
});

test('saved prepared replies bypass repeated normalization as well as rewriting',async()=>{
  const first=await approveWithoutRewrite('**# Saved**','final');
  assert.equal(first.text,'# Saved');
  assert.deepEqual(await approveWithoutRewrite(first.text,'final',{prepared:true}),first);
});

test('a complete shorter rewrite can exceed the readability target',async()=>{
  const result=await approveReply('x'.repeat(4000),'final',async()=>'y'.repeat(800));
  assert.deepEqual(result,{text:'y'.repeat(800),fallback:false});
});

test('only actual delivery overflow needs a failure notice when shortening fails',async()=>{
  const result=await approveReply('x'.repeat(3901),'final',async()=>{throw Error('Provider unavailable');});
  assert.equal(result.fallback,true);
  assert.match(result.text,/couldn’t prepare/);
  assert.equal(deliveryProblem(result.text),null);
  assert.equal(deliveryProblem('x'.repeat(3900)),null);
  assert.ok(deliveryProblem('x'.repeat(3901)));
  assert.equal(deliveryProblem('🙂'.repeat(1950)),null);
  assert.ok(deliveryProblem('🙂'.repeat(1951)));
});

test('empty or unsafe originals fail honestly without asking a model to invent a reply',async()=>{
  for(const original of ['', '  ', 'A\u0000B']) {
    const result=await approveWithoutRewrite(original,'final');
    assert.equal(result.fallback,true);
    assert.match(result.text,/couldn’t prepare/);
    assert.ok(!result.text.includes('fit'));
  }
});

test('progress updates append the stop instruction once and count it inside 240 characters',async()=>{
  const result=await approveWithoutRewrite('**Found two schools.**','progress');
  assert.deepEqual(result,{text:`Found two schools. ${STOP}`,fallback:false});
  const again=await approveWithoutRewrite(result.text+' '+STOP,'progress');
  assert.deepEqual(again,result);
  const exact='x'.repeat(240-STOP.length-1)+' '+STOP;
  assert.equal(replyProblem(exact,'progress'),null);
  assert.ok(replyProblem('x'+exact,'progress'));
  assert.ok(replyProblem('Found two schools.','progress'));
  assert.ok(replyProblem(STOP,'progress'),'the cancel instruction alone is not a progress update');
});

test('a failed progress rewrite uses a short honest notice with the stop instruction',async()=>{
  let calls=0;
  const original='Working. '.repeat(40);
  const result=await approveReply(original,'progress',async(text,kind)=>{
    calls++;
    assert.equal(text,original);
    assert.equal(kind,'progress');
    throw Error('Unavailable');
  });
  assert.equal(calls,1);
  assert.equal(result.fallback,true);
  assert.match(result.text,/couldn’t fit this update/);
  assert.ok(result.text.endsWith(STOP));
  assert.equal(replyProblem(result.text,'progress'),null);
});
