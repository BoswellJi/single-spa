export function bootstrap() {
  return Promise.resolve().then(() => {
    console.log('bootstrap');
  });
}
export const mount = [
  function() {
    return Promise.resolve().then(() => {
      console.log('mount');
    });
  },
  function() {
    return Promise.resolve().then(() => {
      console.log('mount1');
    });
  },
];
export function unmount() {
  return Promise.resolve().then(() => {
    console.log('unmount');
  });
}

// export default  {
//   bootstrap() {
//     return Promise.resolve().then(() => {
//       console.log('bootstrap');
//     });
//   },
//   mount() {
//     return Promise.resolve().then(() => {
//       console.log('mount');
//     });
//   },
//   unmount() {
//     return Promise.resolve().then(() => {
//       console.log('unmount');
//     });
//   },
// };
