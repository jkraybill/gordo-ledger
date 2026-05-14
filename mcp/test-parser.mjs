import { parseGenericFiles } from './dist/parser/generic-file-parser.js';

const config = {
  indexDocs: true,
  indexCode: true
};

parseGenericFiles('/home/jkraybill/home-server', config).then(files => {
  console.log(`Found ${files.length} files`);
  console.log('Content types:');
  const types = {};
  files.forEach(f => {
    types[f.contentType] = (types[f.contentType] || 0) + 1;
  });
  console.log(types);
  console.log('\nFirst 5 files:');
  files.slice(0, 5).forEach(f => {
    console.log(`  - ${f.id} (${f.contentType})`);
  });
}).catch(err => {
  console.error('Error:', err);
});
