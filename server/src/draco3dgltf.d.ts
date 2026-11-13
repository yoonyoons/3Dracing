declare module 'draco3dgltf' {
  const draco: { createDecoderModule(): Promise<unknown>; createEncoderModule(): Promise<unknown> };
  export default draco;
}
