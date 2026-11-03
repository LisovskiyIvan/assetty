import{b6 as r}from"./index-q74-en5_.js";const e="boundingBoxRendererPixelShader",n=`uniform color: vec4f;
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
fragmentOutputs.color=uniforms.color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;r.ShadersStoreWGSL[e]||(r.ShadersStoreWGSL[e]=n);const t={name:e,shader:n};export{t as boundingBoxRendererPixelShaderWGSL};
