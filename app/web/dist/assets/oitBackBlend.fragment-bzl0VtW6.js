import{b6 as e}from"./index-D8wS8RSU.js";const t="oitBackBlendPixelShader",r=`var uBackColor: texture_2d<f32>;@fragment
fn main(input: FragmentInputs)->FragmentOutputs {fragmentOutputs.color=textureLoad(uBackColor,vec2i(fragmentInputs.position.xy),0);if (fragmentOutputs.color.a==0.0) {discard;}}
`;e.ShadersStoreWGSL[t]||(e.ShadersStoreWGSL[t]=r);const o={name:t,shader:r};export{o as oitBackBlendPixelShaderWGSL};
